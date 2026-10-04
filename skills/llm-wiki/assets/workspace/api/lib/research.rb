# frozen_string_literal: true

# Research — Deep research orchestration
#
# Replicates the original deep-research.ts pipeline:
# 1. Generate search queries from topic (or accept pre-defined queries)
# 2. Execute web searches (Tavily/SerpApi/SearXNG)
# 3. LLM synthesizes results into a wiki query page
# 4. Save to wiki/queries/ with proper frontmatter + [[wikilinks]]
# 5. Track task state for UI

module Research
  extend self

  MAX_SOURCES = 20
  TASKS_FILE = ".llm-wiki/research-tasks.json"

  # Execute a full deep research pipeline
  def execute(project_path, topic, queries = nil)
    task_id = SecureRandom.uuid
    queries ||= [topic]

    # Track task
    save_task(project_path, {
      "id" => task_id,
      "topic" => topic,
      "queries" => queries,
      "status" => "searching",
      "created_at" => Time.now.iso8601
    })

    # Step 1: Web search
    search_results = collect_sources(queries, project_path)
    update_task(project_path, task_id, "status" => "synthesizing", "result_count" => search_results.size)

    if search_results.empty?
      update_task(project_path, task_id, "status" => "error", "error" => "No search results found")
      return { "task_id" => task_id, "status" => "error", "error" => "No search results found" }
    end

    # Step 2: LLM synthesis
    wiki_index = read_file_safe(File.join(project_path, "wiki", "index.md"))
    synthesis = synthesize(topic, search_results, wiki_index)
    if synthesis.start_with?("(LLM call failed:", "(LLM connection failed:")
      update_task(project_path, task_id, "status" => "error", "error" => synthesis)
      return { "task_id" => task_id, "status" => "error", "error" => synthesis }
    end
    update_task(project_path, task_id, "status" => "saving")

    # Step 3: Save to wiki
    saved_path = save_research_page(project_path, topic, synthesis, search_results)
    update_task(project_path, task_id, "status" => "done", "saved_path" => saved_path)

    { "task_id" => task_id, "status" => "done", "saved_path" => saved_path, "result_count" => search_results.size }
  end

  # List all research tasks
  def list_tasks(project_path)
    tasks_path = File.join(project_path, TASKS_FILE)
    return [] unless File.exist?(tasks_path)
    JSON.parse(File.read(tasks_path)) rescue []
  end

  private

  # ── Web Search ───────────────────────────────────────────────────────────

  def collect_sources(queries, project_path)
    settings = load_search_settings(project_path)
    all_results = []
    seen_urls = Set.new

    queries.each do |query|
      results = web_search(query.strip, settings)
      results.each do |r|
        key = (r["url"] || "#{r['title']}:#{r['snippet']}").downcase
        next if seen_urls.include?(key)
        seen_urls << key
        all_results << r
        break if all_results.size >= MAX_SOURCES
      end
      break if all_results.size >= MAX_SOURCES
    end

    all_results
  end

  def web_search(query, settings)
    provider = settings["search_provider"] || "tavily"
    api_key = settings["search_api_key"] || ""

    case provider
    when "tavily"
      search_tavily(query, api_key)
    when "serpapi"
      search_serpapi(query, api_key)
    when "searxng"
      search_searxng(query, settings["searxng_url"] || "http://localhost:8080")
    else
      []
    end
  rescue
    []
  end

  def search_tavily(query, api_key)
    return [] if api_key.empty?

    uri = URI("https://api.tavily.com/search")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.read_timeout = 30

    request = Net::HTTP::Post.new(uri)
    request["Content-Type"] = "application/json"
    request.body = JSON.generate({
      api_key: api_key,
      query: query,
      max_results: 5,
      include_answer: false
    })

    response = http.request(request)
    return [] unless response.code.to_i == 200

    data = JSON.parse(response.body)
    (data["results"] || []).map { |r|
      { "title" => r["title"], "snippet" => r["content"], "url" => r["url"], "source" => "tavily" }
    }
  rescue
    []
  end

  def search_serpapi(query, api_key)
    return [] if api_key.empty?

    uri = URI("https://serpapi.com/search.json")
    uri.query = URI.encode_www_form(q: query, api_key: api_key, num: 5)
    response = Net::HTTP.get_response(uri)
    return [] unless response.code.to_i == 200

    data = JSON.parse(response.body)
    (data["organic_results"] || []).first(5).map { |r|
      { "title" => r["title"], "snippet" => r["snippet"], "url" => r["link"], "source" => "serpapi" }
    }
  rescue
    []
  end

  def search_searxng(query, base_url)
    uri = URI("#{base_url}/search")
    uri.query = URI.encode_www_form(q: query, format: "json", categories: "general")
    response = Net::HTTP.get_response(uri)
    return [] unless response.code.to_i == 200

    data = JSON.parse(response.body)
    (data["results"] || []).first(5).map { |r|
      { "title" => r["title"], "snippet" => r["content"], "url" => r["url"], "source" => "searxng" }
    }
  rescue
    []
  end

  # ── LLM Synthesis ───────────────────────────────────────────────────────

  def synthesize(topic, results, wiki_index)
    search_context = results.each_with_index.map { |r, i|
      "[#{i + 1}] **#{r['title']}** (#{r['source']})\n#{r['snippet']}"
    }.join("\n\n")

    system_prompt = <<~PROMPT
      You are a research assistant. Synthesize the collected research sources into a comprehensive wiki page.

      ## Cross-referencing (IMPORTANT)
      - The wiki already has existing pages listed in the Wiki Index below.
      - When your synthesis mentions an entity or concept that exists in the wiki, ALWAYS use [[wikilink]] syntax to link to it.
      - Use the target's canonical wiki-relative id including its directory,
        for example [[concepts/knowledge-graph]]. Omit the leading wiki/ and
        trailing .md; never emit a cross-folder bare filename.

      ## Writing Rules
      - Organize into clear sections with headings
      - Cite sources using [N] notation
      - Note contradictions or gaps
      - Suggest additional sources worth finding
      - Neutral, encyclopedic tone

      #{wiki_index.empty? ? "" : "## Existing Wiki Index (link to these pages with [[wikilink]])\n#{wiki_index[0..3000]}"}
    PROMPT

    Ingest.send(:call_llm,
      system: system_prompt,
      user: "Research topic: **#{topic}**\n\n## Research Sources\n\n#{search_context}\n\nSynthesize into a wiki page.",
      max_tokens: 8192,
      temperature: 0.3
    )
  end

  # ── Save Research Page ──────────────────────────────────────────────────

  def save_research_page(project_path, topic, synthesis, results)
    slug = WikiEngine.slugify("research-#{topic}")
    date = Time.now.strftime("%Y-%m-%d")
    filename = "#{slug}-#{date}.md"
    rel_path = "wiki/queries/#{filename}"
    full_path = File.join(project_path, rel_path)
    FileUtils.mkdir_p(File.dirname(full_path))

    references = results.each_with_index.map { |r, i|
      "#{i + 1}. [#{r['title']}](#{r['url']}) — #{r['source']}"
    }.join("\n")

    # Strip thinking blocks
    clean_synthesis = synthesis
      .gsub(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>/i, "")
      .gsub(/<think(?:ing)?>\s*[\s\S]*$/i, "")
      .strip

    body = <<~MD
      # Research: #{topic.to_s.lines.first.to_s.strip}

      #{clean_synthesis}

      ## References

      #{references}
    MD
    content = WikiEngine.render_page({
      "type" => "query",
      "title" => "Research: #{topic.to_s.lines.first.to_s.strip}",
      "created" => date,
      "origin" => "deep-research",
      "tags" => ["research"]
    }, body)

    Storage.atomic_write(full_path, content, encoding: "utf-8")
    rel_path
  end

  # ── Task Persistence ────────────────────────────────────────────────────

  def save_task(project_path, task)
    path = File.join(project_path, TASKS_FILE)
    Storage.update_json(path, []) do |tasks|
      tasks << task
      tasks.last(50)
    end
  end

  def update_task(project_path, task_id, updates)
    path = File.join(project_path, TASKS_FILE)
    Storage.update_json(path, []) do |tasks|
      task = tasks.find { |item| item["id"] == task_id }
      task&.merge!(updates)
      tasks.last(50)
    end
  end

  def write_tasks(project_path, tasks)
    dir = File.join(project_path, ".llm-wiki")
    FileUtils.mkdir_p(dir)
    # Keep only last 50 tasks
    tasks = tasks.last(50)
    Storage.atomic_write(File.join(project_path, TASKS_FILE), JSON.pretty_generate(tasks))
  end

  def load_search_settings(project_path)
    settings_file = File.expand_path("~/.clacky/ext/data/llm-wiki/settings.json")
    return {} unless File.exist?(settings_file)
    JSON.parse(File.read(settings_file))
  rescue
    {}
  end

  def read_file_safe(path)
    File.exist?(path) ? File.read(path, encoding: "utf-8") : ""
  rescue
    ""
  end
end

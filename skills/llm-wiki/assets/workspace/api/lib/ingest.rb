# frozen_string_literal: true

# Ingest — Two-step chain-of-thought ingestion engine
#
# Replicates the original llm_wiki's auto-ingest pipeline:
# Step 1: Analysis — LLM reads source, identifies entities/concepts/connections
# Step 2: Generation — LLM produces wiki FILE blocks from the analysis
#
# Uses the LLM provider already configured in OpenClacky.

module Ingest
  extend self

  CACHE_DIR = ".llm-wiki"
  CACHE_FILE = "ingest-cache.json"
  FILE_BLOCK_REGEX = /---FILE:\s*(.+?)\s*---\n([\s\S]*?)---END FILE---/
  REVIEW_BLOCK_REGEX = /---REVIEW:\s*(.+?)\s*---\n([\s\S]*?)---END REVIEW---/
  class SourceChanged < ArgumentError; end

  # The Codex agent performs analysis and page writes. These deterministic
  # receipts preserve the original source-hash cache without calling a model.
  def source_status(project_path, source_rel, source_full)
    full = checked_ingest_file(project_path, source_rel, "raw/sources/")
    raise ArgumentError, "Source path mismatch" unless File.expand_path(source_full) == full
    digest = Digest::SHA256.file(full).hexdigest
    entry = native_ingest_cache(project_path)[source_rel]
    files = entry.is_a?(Hash) && entry["files"].is_a?(Array) ? entry["files"] : []
    missing = files.reject do |relative|
      begin
        checked_ingest_file(project_path, relative, "wiki/")
        true
      rescue ArgumentError
        false
      end
    end
    same_hash = entry.is_a?(Hash) && entry["hash"] == digest
    {
      "source_path" => source_rel, "source_sha256" => digest,
      "ingested" => same_hash && !files.empty? && missing.empty?,
      "changed" => entry.is_a?(Hash) && !same_hash,
      "files" => files, "missing_files" => missing,
      "ingested_at" => entry.is_a?(Hash) ? entry["ingested_at"] : nil
    }
  end

  def record_completion(project_path, source_rel, source_full, source_sha256:, files:)
    raise ArgumentError, "A source SHA-256 is required" unless source_sha256.is_a?(String) && source_sha256.match?(/\A[0-9a-f]{64}\z/)
    raise ArgumentError, "At least one saved wiki page is required" unless files.is_a?(Array) && !files.empty? && files.all? { |file| file.is_a?(String) }
    Storage.with_lock(File.join(project_path, CACHE_DIR, "write.lock")) do
      full = checked_ingest_file(project_path, source_rel, "raw/sources/")
      raise ArgumentError, "Source path mismatch" unless File.expand_path(source_full) == full
      files = files.uniq
      files.each { |relative| checked_ingest_file(project_path, relative, "wiki/") }
      raise SourceChanged, "Source changed during ingest; reread it before recording completion" unless Digest::SHA256.file(full).hexdigest == source_sha256
      cache = native_ingest_cache(project_path)
      cache[source_rel] = { "hash" => source_sha256, "files" => files, "ingested_at" => Time.now.iso8601 }
      Storage.atomic_write(File.join(project_path, CACHE_DIR, CACHE_FILE), JSON.pretty_generate(cache))
      source_status(project_path, source_rel, source_full)
    end
  end

  # Check if source has been ingested before (SHA256 cache)
  def check_cache(project_path, source_rel, source_full)
    cache = load_cache(project_path)
    current_hash = Digest::SHA256.file(source_full).hexdigest
    entry = cache[source_rel]
    return nil unless entry && entry["hash"] == current_hash
    entry["files"]
  end

  # Run the two-step ingest pipeline
  def run(project_path, source_rel, source_full)
    source_content = read_source(source_full)
    source_identity = source_rel.sub(%r{^raw/sources/}, "")

    # Load project context
    purpose = read_file_safe(File.join(project_path, "purpose.md"))
    schema = read_file_safe(File.join(project_path, "schema.md"))
    index = read_file_safe(File.join(project_path, "wiki", "index.md"))
    overview = read_file_safe(File.join(project_path, "wiki", "overview.md"))

    # Truncate source if too long (budget management)
    max_source_chars = compute_source_budget(source_content.length)
    truncated_source = source_content.length > max_source_chars ? source_content[0...max_source_chars] + "\n\n[... truncated ...]" : source_content

    # Step 1: Analysis
    analysis = call_llm(
      system: build_analysis_prompt(purpose, index, truncated_source, schema),
      user: "Analyze this source document:\n\n**File:** #{source_identity}\n\n---\n\n#{truncated_source}",
      max_tokens: 4096,
      temperature: 0.1
    )
    raise analysis if analysis.start_with?("(LLM call failed:", "(LLM connection failed:")

    # Step 2: Generation
    source_basename = File.basename(source_identity, File.extname(source_identity))
    source_summary_path = "wiki/sources/#{WikiEngine.slugify(source_basename)}.md"
    generation = call_llm(
      system: build_generation_prompt(schema, purpose, index, source_identity, overview, truncated_source, source_summary_path),
      user: build_generation_user_message(source_identity, analysis, truncated_source),
      max_tokens: compute_generation_max_tokens,
      temperature: 0.1
    )
    raise generation if generation.start_with?("(LLM call failed:", "(LLM connection failed:")

    # Parse FILE blocks
    files_written = write_file_blocks(project_path, generation, source_identity, source_summary_path)

    # Parse REVIEW blocks
    review_items = parse_review_blocks(generation, source_rel)

    # Update index deterministically
    update_index(project_path, files_written)

    # Save cache
    save_cache(project_path, source_rel, source_full, files_written)

    # Save review items
    Review.add_items(project_path, review_items) if review_items.any?

    { files: files_written, review_items: review_items }
  end

  private

  def checked_ingest_file(project_path, relative, prefix)
    valid = relative.is_a?(String) && relative.start_with?(prefix) &&
      !relative.match?(/[\\\x00-\x1f]/) && !relative.split("/", -1).any? { |part| ["", ".", ".."].include?(part) }
    valid &&= relative.end_with?(".md") if prefix == "wiki/"
    raise ArgumentError, "Use an existing project-relative #{prefix} file" unless valid
    full = File.expand_path(relative, project_path)
    raise ArgumentError, "Referenced source or wiki page does not exist" unless File.file?(full)
    canonical = File.join(File.realpath(project_path), relative)
    raise ArgumentError, "Symlinked sources or wiki pages are unsupported" unless File.realpath(full) == canonical
    full
  rescue Errno::ENOENT, Errno::ENOTDIR, Errno::ELOOP
    raise ArgumentError, "Referenced source or wiki page does not exist"
  end

  def native_ingest_cache(project_path)
    path = File.join(project_path, CACHE_DIR, CACHE_FILE)
    return {} unless File.exist?(path)
    cache = JSON.parse(File.read(path, encoding: "utf-8"))
    raise ArgumentError, "Ingest history is malformed; preserve it for recovery" unless cache.is_a?(Hash)
    cache
  rescue JSON::ParserError
    raise ArgumentError, "Ingest history is malformed; preserve it for recovery"
  end

  def read_file_safe(path)
    File.exist?(path) ? File.read(path, encoding: "utf-8") : ""
  rescue
    ""
  end

  def read_source(path)
    ext = File.extname(path).downcase
    case ext
    when ".pdf"
      extract_pdf(path)
    when ".docx"
      extract_docx(path)
    when ".xlsx", ".csv"
      extract_spreadsheet(path)
    else
      File.read(path, encoding: "utf-8")
    end
  rescue => e
    File.read(path, encoding: "utf-8") rescue "(Failed to read: #{e.message})"
  end

  def extract_pdf(path)
    # Try pdf-reader gem, fallback to pdftotext command
    begin
      require "pdf-reader"
      reader = PDF::Reader.new(path)
      reader.pages.map(&:text).join("\n\n---\n\n")
    rescue LoadError
      result, status = Open3.capture2("pdftotext", "-layout", path, "-")
      result = "" unless status.success?
      result.empty? ? "(PDF extraction failed — install pdf-reader gem or pdftotext)" : result
    rescue Errno::ENOENT
      "(PDF extraction failed — install pdf-reader gem or pdftotext)"
    end
  end

  def extract_docx(path)
    begin
      require "docx"
      doc = Docx::Document.open(path)
      doc.paragraphs.map(&:text).join("\n\n")
    rescue LoadError
      "(DOCX extraction requires the 'docx' gem)"
    end
  end

  def extract_spreadsheet(path)
    begin
      require "roo"
      spreadsheet = Roo::Spreadsheet.open(path)
      output = []
      spreadsheet.sheets.each do |sheet_name|
        sheet = spreadsheet.sheet(sheet_name)
        output << "## Sheet: #{sheet_name}\n"
        sheet.each_row_streaming do |row|
          output << row.map { |c| c&.value.to_s }.join(" | ")
        end
      end
      output.join("\n")
    rescue LoadError
      "(Spreadsheet extraction requires the 'roo' gem)"
    end
  end

  def compute_source_budget(source_length)
    # Mirror original: 50% of context for source, max 300K chars
    [source_length, 300_000].min
  end

  def compute_generation_max_tokens
    8192
  end

  def build_analysis_prompt(purpose, index, source, schema)
    lang_directive = detect_language_directive(source)
    <<~PROMPT
      You are a knowledge analyst. Your task is to analyze a source document and identify its key information for integration into a personal wiki.

      #{lang_directive}

      ## Your Analysis Must Cover:
      1. **Key Entities** — People, organizations, products, technologies mentioned
      2. **Core Concepts** — Ideas, methods, theories, frameworks
      3. **Main Arguments/Claims** — What does the source assert?
      4. **Relationships** — How do entities and concepts connect?
      5. **Connections to Existing Wiki** — What existing pages relate?
      6. **Contradictions/Updates** — Does this contradict or update existing knowledge?
      7. **Knowledge Gaps** — What follow-up research would be valuable?

      ## Context

      ### Wiki Purpose
      #{purpose.empty? ? "(Not defined)" : purpose}

      ### Current Wiki Index
      #{index.empty? ? "(Empty wiki)" : index[0..3000]}

      ### Wiki Schema
      #{schema.empty? ? "(Default schema)" : schema[0..2000]}

      ## Instructions
      - Be thorough but concise
      - Use bullet points
      - Identify the most useful page TYPE for each piece of information from the
        user-confirmed project taxonomy in schema.md. If a genuinely new type is
        needed but its boundary is uncertain, return it as a review question
        instead of silently creating a generic category.
      - Note exact canonical [[wikilink]] targets for cross-references. Include
        the wiki-relative directory, for example [[drafts/argument]], while
        omitting the leading wiki/ and trailing .md.
    PROMPT
  end

  def build_generation_prompt(schema, purpose, index, source_identity, overview, source_content, source_summary_path)
    lang_directive = detect_language_directive(source_content)
    <<~PROMPT
      You are a wiki page generator. Based on the analysis of a source document, produce wiki pages in the exact format specified below.

      #{lang_directive}

      ## Output Format

      For each wiki page, output:
      ```
      ---FILE: wiki/<type>/<slug>.md---
      ---
      type: <the most precise schema or content-derived type>
      title: "<Page Title>"
      sources:
        - #{source_identity}
      created: #{Time.now.strftime("%Y-%m-%d")}
      ---

      # <Page Title>

      <Content with canonical [[directory/page-slug]] wikilinks to related pages>

      ## Related
      - [[concepts/related-page-1]]
      - [[sources/related-page-2]]
      ---END FILE---
      ```

      ## Rules
      1. ALWAYS generate a source summary at `#{source_summary_path}`
      2. Use canonical [[directory/page-slug]] syntax for ALL cross-references.
         Omit the leading wiki/ and trailing .md. Never emit a cross-folder bare
         filename such as [[page-slug]].
      3. Every page MUST have frontmatter with type, title, sources
      4. Merge into an existing page when the same subject already exists
      5. Create NEW pages only for genuinely new subjects that belong in the confirmed taxonomy
      6. Keep each page focused — one main topic per page
      7. Use the schema's type system: #{schema[0..500]}

      ## Also generate REVIEW blocks for follow-up research:
      ```
      ---REVIEW: Short description---
      Detailed explanation of what to research and why.
      TYPE: research|verify|expand
      ---END REVIEW---
      ```

      ## Wiki Purpose
      #{purpose[0..500]}

      ## Current Index
      #{index[0..2000]}

      ## Overview
      #{overview[0..1000]}
    PROMPT
  end

  def build_generation_user_message(source_identity, analysis, source_context)
    [
      "Source document to process: **#{source_identity}**",
      "",
      "The Stage 1 analysis below is CONTEXT to inform your output. Do NOT echo",
      "its tables, bullet points, or prose. Your output must be FILE/REVIEW",
      "blocks as specified in the system prompt — nothing else.",
      "",
      "## Stage 1 Analysis (context only — do not repeat)",
      "",
      analysis,
      "",
      "## Source Context",
      "",
      source_context[0..8000],
      "",
      "---",
      "",
      "Now emit the FILE blocks for the wiki files derived from **#{source_identity}**.",
      "Your response MUST begin with `---FILE:` as the very first characters.",
      "No preamble. No analysis prose. Start immediately."
    ].join("\n")
  end

  def write_file_blocks(project_path, generation, source_identity, source_summary_path)
    blocks = parse_file_blocks(generation)
    written = []

    blocks.each do |block|
      rel_path = block[:path]
      next unless safe_ingest_path?(rel_path)

      full_path = File.join(project_path, rel_path)
      FileUtils.mkdir_p(File.dirname(full_path))

      # Merge if page already exists
      if File.exist?(full_path)
        existing = File.read(full_path, encoding: "utf-8")
        content = merge_page_content(existing, block[:content], source_identity)
      else
        content = block[:content]
      end

      Storage.atomic_write(full_path, content, encoding: "utf-8")
      written << rel_path
    end

    # Ensure source summary exists
    unless written.include?(source_summary_path)
      full = File.join(project_path, source_summary_path)
      unless File.exist?(full)
        FileUtils.mkdir_p(File.dirname(full))
        fallback = build_fallback_source_summary(source_identity)
        Storage.atomic_write(full, fallback, encoding: "utf-8")
        written << source_summary_path
      end
    end

    written.uniq
  end

  def parse_file_blocks(text)
    blocks = []
    normalized = text.gsub("\r\n", "\n")
    lines = normalized.split("\n")

    i = 0
    while i < lines.length
      opener = lines[i].match(/^---\s*FILE:\s*(.+?)\s*---\s*$/i)
      unless opener
        i += 1
        next
      end
      path = opener[1].strip
      i += 1
      content_lines = []
      fence_depth = 0
      closed = false

      while i < lines.length
        line = lines[i]
        # Track code fences
        if line.match?(/^\s{0,3}(```+|~~~+)/)
          fence_depth = fence_depth == 0 ? 1 : 0
        end
        # Only close when not inside a code fence
        if fence_depth == 0 && line.match?(/^---\s*END\s+FILE\s*---\s*$/i)
          closed = true
          i += 1
          break
        end
        content_lines << line
        i += 1
      end

      # Accept unclosed blocks (LLM truncation) but warn
      if !closed
        next if content_lines.empty?
      end

      blocks << { path: path, content: content_lines.join("\n") } unless path.empty?
    end

    blocks
  end

  def parse_review_blocks(text, source_path)
    items = []
    text.scan(/---REVIEW:\s*(.+?)\s*---\n([\s\S]*?)---END REVIEW---/i) do |title, body|
      type_match = body.match(/^TYPE:\s*(\w+)/i)
      type = type_match ? type_match[1].downcase : "research"
      detail = body.sub(/^TYPE:.*$/i, "").strip
      items << {
        "id" => SecureRandom.uuid,
        "title" => title.strip,
        "detail" => detail,
        "type" => type,
        "source" => source_path,
        "created_at" => Time.now.iso8601,
        "status" => "pending"
      }
    end
    items
  end

  def safe_ingest_path?(path)
    return false if path.nil? || path.strip.empty?
    return false if path.start_with?("/") || path.start_with?("\\")
    return false if path.match?(/^[a-zA-Z]:/)
    return false if path.include?("..")
    return false unless path.start_with?("wiki/")
    return false if path.match?(/[\x00-\x1f]/)
    true
  end

  def merge_page_content(existing, new_content, source_identity)
    existing_fm, existing_body = WikiEngine.split_frontmatter(existing)
    new_fm, new_body = WikiEngine.split_frontmatter(new_content)
    sources = Array(existing_fm["sources"]) | Array(new_fm["sources"]) | [source_identity]
    merged_fm = new_fm.merge(existing_fm)
    merged_fm["sources"] = sources

    incoming = new_body.to_s.strip
    incoming = incoming.sub(/\A#\s+[^\n]+\n+/, "").strip
    return WikiEngine.render_page(merged_fm, existing_body) if incoming.empty? || existing_body.include?(incoming)

    heading = "## Update from #{source_identity}"
    merged_body = "#{existing_body.rstrip}\n\n#{heading}\n\n#{incoming}\n"
    WikiEngine.render_page(merged_fm, merged_body)
  end

  def build_fallback_source_summary(source_identity)
    <<~MD
      ---
      type: source
      title: "Source: #{source_identity}"
      sources:
        - #{source_identity}
      created: #{Time.now.strftime("%Y-%m-%d")}
      ---

      # Source: #{source_identity}

      _This source summary was auto-generated. Full analysis pending._
    MD
  end

  def update_index(project_path, written_paths)
    index_path = File.join(project_path, "wiki", "index.md")
    index = File.exist?(index_path) ? File.read(index_path, encoding: "utf-8") : "# Wiki Index\n"

    # Extract existing wikilink targets
    existing_targets = index.scan(/\[\[([^\]|#]+)/).flatten.map { |t| t.strip.downcase }

    additions = []
    written_paths.each do |wpath|
      next unless wpath.start_with?("wiki/") && wpath.end_with?(".md")
      next if %w[wiki/index.md wiki/overview.md wiki/log.md].include?(wpath)

      target = wpath.sub(/^wiki\//, "").sub(/\.md$/, "")
      next if existing_targets.include?(target.downcase)

      # Read title
      full = File.join(project_path, wpath)
      next unless File.exist?(full)
      content = File.read(full, encoding: "utf-8")
      title = WikiEngine.extract_title(content, wpath)
      additions << "- [[#{target}]] — #{title}"
    end

    return if additions.empty?

    # Append to "## Recently Updated" section
    section_header = "## Recently Updated"
    if index.include?(section_header)
      index.sub!(section_header, "#{section_header}\n#{additions.join("\n")}")
    else
      index += "\n#{section_header}\n#{additions.join("\n")}\n"
    end

    Storage.atomic_write(index_path, index, encoding: "utf-8")
  end

  # ── LLM Calling ─────────────────────────────────────────────────────────

  def call_llm(system:, user:, max_tokens: 4096, temperature: 0.1)
    # Use Clacky's internal LLM API
    # The extension can call the host's chat completion endpoint
    messages = [
      { role: "system", content: system },
      { role: "user", content: user }
    ]

    # Use the host's configured provider directly.
    begin
      response = internal_llm_call(messages, max_tokens, temperature)
      response
    rescue => e
      "(LLM call failed: #{e.message})"
    end
  end

  def internal_llm_call(messages, max_tokens, temperature)
    # OpenClacky 1.3+ does not expose an unauthenticated local
    # /api/chat/completions proxy. Extensions run in the host process, so use
    # the same configured client as the active agent. This preserves provider
    # routing (OpenAI/Anthropic/Bedrock/OpenRouter), billing, and credentials
    # without duplicating them into extension settings.
    config = Clacky::AgentConfig.load
    raise "No LLM model is configured in OpenClacky" if config.api_key.to_s.empty? || config.base_url.to_s.empty? || config.model_name.to_s.empty?

    client = Clacky::Client.new(
      config.api_key,
      base_url: config.base_url,
      model: config.model_name,
      anthropic_format: config.anthropic_format?,
      read_timeout: 180
    )
    client.send_messages(messages, model: config.model_name, max_tokens: max_tokens)
  rescue => e
    "(LLM connection failed: #{e.message})"
  end

  # ── Cache ────────────────────────────────────────────────────────────────

  def load_cache(project_path)
    cache_path = File.join(project_path, CACHE_DIR, CACHE_FILE)
    return {} unless File.exist?(cache_path)
    JSON.parse(File.read(cache_path))
  rescue
    {}
  end

  def save_cache(project_path, source_rel, source_full, files)
    cache_dir = File.join(project_path, CACHE_DIR)
    FileUtils.mkdir_p(cache_dir)
    cache_path = File.join(cache_dir, CACHE_FILE)

    cache = load_cache(project_path)
    cache[source_rel] = {
      "hash" => Digest::SHA256.file(source_full).hexdigest,
      "files" => files,
      "ingested_at" => Time.now.iso8601
    }
    Storage.atomic_write(cache_path, JSON.pretty_generate(cache))
  end

  # ── Language Detection ───────────────────────────────────────────────────

  def detect_language_directive(content)
    sample = content[0..2000]
    if sample.match?(/[\u4e00-\u9fff\u3400-\u4dbf]/)
      "**Output Language: Chinese (中文)**. Write all wiki content in Chinese."
    elsif sample.match?(/[\u3040-\u30ff]/)
      "**Output Language: Japanese (日本語)**. Write all wiki content in Japanese."
    elsif sample.match?(/[\uac00-\ud7af]/)
      "**Output Language: Korean (한국어)**. Write all wiki content in Korean."
    else
      "**Output Language: Match the source document's language.**"
    end
  end
end

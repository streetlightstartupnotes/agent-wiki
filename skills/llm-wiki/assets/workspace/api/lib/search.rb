# frozen_string_literal: true

# Search — CJK-aware tokenization + keyword scoring + graph expansion
#
# Replicates the original search.ts multi-signal pipeline:
# 1. Tokenize query (CJK bigrams + word tokens)
# 2. Score each wiki page by token hits (title boost + content)
# 3. Expand results via graph neighbors (related nodes get bonus)
# 4. Return ranked results with snippets

module Search
  extend self

  STOP_WORDS = Set.new(%w[
    的 是 了 什么 在 有 和 与 对 从
    the is a an what how are was were
    do does did be been being have has had
    it its in on at to for of with by
    this that these those
  ])

  TITLE_BOOST = 3.0
  GRAPH_EXPANSION_BOOST = 0.4
  SNIPPET_CONTEXT = 80
  DOCUMENT_CACHE_LIMIT = 4

  # Main search entry point
  def query(project_path, query_str, limit: 20)
    tokens = tokenize(query_str)
    return [] if tokens.empty?

    wiki_dir = File.join(project_path, "wiki")
    return [] unless Dir.exist?(wiki_dir)

    scored = []

    search_documents(project_path).each do |document|
      rel_path = document["path"]
      wiki_relative = rel_path.sub(%r{\Awiki/}, "")
      content = document["content"]
      title = document["title"]
      score = compute_score(tokens, title, content, wiki_relative)
      next if score <= 0

      snippet = extract_snippet(content, tokens)
      title_match = tokens.any? { |t| title.downcase.include?(t) }

      scored << {
        "path" => rel_path,
        "title" => title,
        "snippet" => snippet,
        "score" => score.round(3),
        "title_match" => title_match
      }
    end

    # Graph expansion: boost related nodes of top results
    if scored.any?
      top_ids = scored.sort_by { |r| -r["score"] }.first(5).map { |r| WikiEngine.page_id(r["path"]) }
      graph_boost = compute_graph_boost(project_path, top_ids)

      scored.each do |result|
        node_id = WikiEngine.page_id(result["path"])
        result["score"] += graph_boost[node_id] * GRAPH_EXPANSION_BOOST if graph_boost[node_id]
      end
    end

    scored.sort_by { |r| -r["score"] }.first(limit)
  end

  private

  # Keep a process-local content index keyed by file size and modification
  # time. Global knowledge access can trigger searches from many conversations;
  # they should not reread thousands of Markdown files for every question.
  def search_documents(project_path)
    files = Dir.glob(File.join(project_path, "wiki", "**", "*.md")).sort
    signature = files.map do |file|
      stat = File.stat(file)
      "#{file}\0#{stat.size}\0#{stat.mtime.to_f}"
    rescue SystemCallError
      nil
    end.compact.join("\n")

    @document_cache ||= {}
    @document_cache_order ||= []
    @document_cache_mutex ||= Mutex.new
    @document_cache_mutex.synchronize do
      cached = @document_cache[project_path]
      return cached[:documents] if cached && cached[:signature] == signature

      documents = files.each_with_object([]) do |file, collected|
        rel_path = file.sub("#{project_path}/", "")
        wiki_relative = rel_path.sub(%r{\Awiki/}, "")
        next if %w[index.md overview.md log.md].include?(wiki_relative.downcase)
        content = File.read(file, encoding: "utf-8")
        collected << { "path" => rel_path, "title" => WikiEngine.extract_title(content, file), "content" => content }
      rescue SystemCallError, EncodingError
        next
      end

      @document_cache[project_path] = { signature: signature, documents: documents }
      @document_cache_order.delete(project_path)
      @document_cache_order << project_path
      while @document_cache_order.size > DOCUMENT_CACHE_LIMIT
        @document_cache.delete(@document_cache_order.shift)
      end
      documents
    end
  end

  # ── Tokenization ────────────────────────────────────────────────────────
  # Mirrors the original tokenizeQuery() in search.ts:
  # - Split on whitespace/punctuation
  # - Filter stopwords
  # - For CJK tokens > 2 chars: generate bigrams + individual chars
  # - Deduplicate

  def tokenize(query_str)
    raw_tokens = query_str.downcase
      .split(/[\s,，。！？、；："'（）()\-_\/\\·~～…]+/)
      .select { |t| t.length > 1 }
      .reject { |t| STOP_WORDS.include?(t) }

    tokens = []
    raw_tokens.each do |token|
      has_cjk = token.match?(/[\u4e00-\u9fff\u3400-\u4dbf]/)
      if has_cjk && token.length > 2
        chars = token.chars
        # Bigrams
        (0...chars.length - 1).each { |i| tokens << chars[i] + chars[i + 1] }
        # Individual chars (non-stopword)
        chars.each { |ch| tokens << ch unless STOP_WORDS.include?(ch) }
        tokens << token
      else
        tokens << token
      end
    end

    tokens.uniq
  end

  # ── Scoring ─────────────────────────────────────────────────────────────

  def compute_score(tokens, title, content, path = "")
    title_lower = title.downcase
    content_lower = content.downcase
    path_lower = path.downcase
    score = 0.0

    tokens.each do |token|
      # Title matches get boosted
      if title_lower.include?(token)
        score += TITLE_BOOST
      end

      score += 2.0 if path_lower.include?(token)

      # Content frequency (capped to avoid over-weighting)
      count = content_lower.scan(token).size
      score += [count * 0.3, 5.0].min if count > 0
    end

    # Bonus for multiple token matches (query completeness)
    matching_tokens = tokens.count { |t| content_lower.include?(t) }
    coverage = matching_tokens.to_f / tokens.size
    score *= (0.5 + coverage * 0.5) if tokens.size > 1

    score
  end

  # ── Snippet Extraction ──────────────────────────────────────────────────

  def extract_snippet(content, tokens)
    # Strip frontmatter
    body = content.sub(/\A---\n[\s\S]*?\n---\n*/m, "")
    # Strip headings for cleaner snippets
    body = body.gsub(/^#+\s+.+$/, "")
    body_lower = body.downcase

    # Find best window around first token match
    best_pos = nil
    tokens.each do |token|
      pos = body_lower.index(token)
      if pos
        best_pos = pos
        break
      end
    end

    return body[0..200].strip + "..." if best_pos.nil?

    start_pos = [best_pos - SNIPPET_CONTEXT, 0].max
    end_pos = [best_pos + SNIPPET_CONTEXT + 50, body.length].min
    snippet = body[start_pos..end_pos].strip

    snippet = "..." + snippet if start_pos > 0
    snippet = snippet + "..." if end_pos < body.length
    snippet.gsub(/\s+/, " ")
  end

  # ── Graph Expansion ─────────────────────────────────────────────────────
  # Pages related to top keyword hits get a relevance boost

  def compute_graph_boost(project_path, top_node_ids)
    boost = Hash.new(0.0)
    graph = Graph.build(project_path)
    top = top_node_ids.to_set
    graph.fetch("edges", []).each do |edge|
      source = edge["source"]
      target = edge["target"]
      weight = edge["weight"].to_f
      boost[target] += weight * 0.2 if top.include?(source)
      boost[source] += weight * 0.2 if top.include?(target)
    end
    boost
  rescue StandardError
    {}
  end
end

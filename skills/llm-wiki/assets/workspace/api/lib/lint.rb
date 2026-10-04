# frozen_string_literal: true

# Lint — Structural and semantic wiki quality checks
#
# Replicates the original lint.ts:
# - Orphan pages (no inbound links)
# - Broken wikilinks (target doesn't exist)
# - No-outlink pages (information islands)
# - Suggestion: related pages that should be linked
# - Levenshtein-based target suggestion for broken links

module Lint
  extend self

  BROKEN_LINK_SUGGESTION_MIN_SCORE = 0.74
  RELATED_PAGE_SUGGESTION_MIN_SCORE = 0.08
  SAME_FOLDER_BONUS = 0.08
  SAME_BASENAME_SCORE = 0.96
  CONTAINS_TARGET_SCORE = 0.82

  # Run structural lint checks
  def structural(project_path)
    wiki_dir = File.join(project_path, "wiki")
    return [] unless Dir.exist?(wiki_dir)

    # Collect all content pages (exclude index, log, overview)
    md_files = Dir.glob(File.join(wiki_dir, "**", "*.md"))
      .reject { |f| %w[index.md log.md overview.md].include?(f.sub("#{wiki_dir}/", "").downcase) }

    # Build page data
    pages = md_files.map do |file|
      content = File.read(file, encoding: "utf-8") rescue next
      short_name = file.sub("#{wiki_dir}/", "")
      slug = WikiEngine.page_id(short_name)
      title = WikiEngine.extract_title(content, short_name)
      outlinks = WikiEngine.extract_wikilinks(content)
      tokens = tokenize_for_suggestion("#{title}\n#{slug}\n#{content[0..4000]}")

      {
        path: file,
        short_name: short_name,
        slug: slug,
        title: title,
        outlinks: outlinks,
        tokens: tokens,
        folder: short_name.split("/").first
      }
    end.compact

    page_ids = Dir.glob(File.join(wiki_dir, "**", "*.md")).map do |file|
      WikiEngine.page_id(file.sub("#{wiki_dir}/", ""))
    end.to_set

    # Count inbound links (case-insensitive)
    inbound_counts = Hash.new(0)
    pages.each do |p|
      p[:outlinks].each do |link|
        target = WikiEngine.resolve_page_id(link, page_ids, from_id: p[:slug])
        inbound_counts[target] += 1 if target
      end
    end

    results = []

    pages.each do |page|
      # Check: Orphan (no inbound links)
      inbound = inbound_counts[page[:slug]] || 0
      if inbound == 0
        suggested = suggest_related_page(page, pages, "source")
        results << {
          "type" => "orphan",
          "severity" => "info",
          "page" => page[:short_name],
          "title" => page[:title],
          "detail" => "No other pages link to this page.",
          "suggested_source" => suggested&.dig(:short_name)
        }
      end

      # Check: No outbound links
      if page[:outlinks].empty?
        suggested = suggest_related_page(page, pages, "target")
        results << {
          "type" => "no-outlinks",
          "severity" => "info",
          "page" => page[:short_name],
          "title" => page[:title],
          "detail" => "This page has no [[wikilink]] references to other pages.",
          "suggested_target" => suggested&.dig(:short_name)
        }
      end

      # Check: Broken links
      page[:outlinks].each do |link|
        resolved = WikiEngine.resolve_page_id(link, page_ids, from_id: page[:slug])

        unless resolved
          suggested = suggest_broken_target(link, pages)
          results << {
            "type" => "broken-link",
            "severity" => "warning",
            "page" => page[:short_name],
            "title" => page[:title],
            "detail" => "Broken link: [[#{link}]] — target page not found.",
            "broken_target" => link,
            "suggested_target" => suggested&.dig(:short_name)
          }
        end
      end
    end

    results
  end

  private

  def normalize_link_target(target)
    target.strip.downcase.gsub(/\s+/, "-").sub(/\.md$/i, "")
  end

  def tokenize_for_suggestion(text)
    tokens = Set.new
    normalized = text.unicode_normalize(:nfkc).downcase
    normalized.scan(/[\p{L}\p{N}]+/u).each do |token|
      tokens << token if token.length >= 2
      # CJK individual chars
      if token.match?(/[\u3400-\u9fff]/u)
        token.chars.each { |ch| tokens << ch }
      end
    end
    tokens
  end

  def string_similarity(a, b)
    left = normalize_link_target(a)
    right = normalize_link_target(b)
    return 0 if left.empty? || right.empty?
    return 1.0 if left == right

    left_base = File.basename(left)
    right_base = File.basename(right)
    return SAME_BASENAME_SCORE if left_base == right_base
    return CONTAINS_TARGET_SCORE if right.include?(left) || left.include?(right)
    return 0 if left_base.length < 5 || right_base.length < 5

    max_len = [left_base.length, right_base.length].max
    1.0 - levenshtein(left_base, right_base).to_f / max_len
  end

  def levenshtein(a, b)
    return b.length if a.empty?
    return a.length if b.empty?

    matrix = Array.new(a.length + 1) { |i| i }
    (1..b.length).each do |j|
      prev = matrix[0]
      matrix[0] = j
      (1..a.length).each do |i|
        temp = matrix[i]
        cost = a[i - 1] == b[j - 1] ? 0 : 1
        matrix[i] = [matrix[i] + 1, matrix[i - 1] + 1, prev + cost].min
        prev = temp
      end
    end
    matrix[a.length]
  end

  def suggest_broken_target(target, pages)
    best = nil
    best_score = 0

    pages.each do |candidate|
      score = [
        string_similarity(target, candidate[:slug]),
        string_similarity(target, candidate[:short_name]),
        string_similarity(target, candidate[:title])
      ].max

      if score > best_score
        best_score = score
        best = candidate
      end
    end

    best_score >= BROKEN_LINK_SUGGESTION_MIN_SCORE ? best : nil
  end

  def suggest_related_page(page, pages, direction)
    page_ids = pages.map { |candidate| candidate[:slug] }.to_set
    existing_outlinks = page[:outlinks].map do |link|
      WikiEngine.resolve_page_id(link, page_ids, from_id: page[:slug])
    end.compact.to_set
    best = nil
    best_score = 0

    pages.each do |candidate|
      next if candidate[:short_name] == page[:short_name]

      if direction == "target"
        next if existing_outlinks.include?(candidate[:slug])
      end

      # Token overlap scoring
      overlap = (page[:tokens] & candidate[:tokens]).size
      next if overlap == 0

      folder_bonus = page[:folder] == candidate[:folder] ? SAME_FOLDER_BONUS : 0
      score = overlap.to_f / Math.sqrt([1, page[:tokens].size].max * [1, candidate[:tokens].size].max) + folder_bonus

      if score > best_score
        best_score = score
        best = candidate
      end
    end

    best_score >= RELATED_PAGE_SUGGESTION_MIN_SCORE ? best : nil
  end
end

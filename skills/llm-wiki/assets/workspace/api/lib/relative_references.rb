# frozen_string_literal: true

require "pathname"
require "uri"
require "cgi"

# Rebase local Markdown/HTML destinations without reserializing a document.
# Wiki [[links]] keep their existing separate resolution rules.
module RelativeReferences
  extend self

  DESTINATION = /<[^>\r\n]*>|(?:\\.|[^\s()\\]|\((?:\\.|[^()\\])*\))+/

  def rebase(content, project_path:, from:, to:, mapping: {})
    return content if from == to
    transform = proc do |reference|
      rewritten = rebase_target(reference, project_path, from, to, mapping)
      yield if block_given? && rewritten != reference
      rewritten
    end
    rewrite_prose(content) { |prose| rewrite_destinations(prose, &transform) }
  end

  private

  def rebase_target(reference, project_path, from, to, mapping)
    wrapped = reference.start_with?("<") && reference.end_with?(">")
    raw = wrapped ? reference[1...-1] : reference
    path, suffix = raw.split(/(?=[?#])/, 2)
    return reference if path.to_s.empty? || path.start_with?("/", "\\") || path.match?(/\A[a-z][a-z0-9+.-]*:/i)
    decoded = decode_path(path)
    return reference unless decoded.valid_encoding?
    canonical = decoded.start_with?("wiki/")
    root = File.expand_path(project_path)
    old_base = canonical ? root : File.dirname(File.join(root, from))
    target = File.expand_path(decoded, old_base)
    return reference unless target.start_with?("#{root}/")
    target_relative = target.delete_prefix("#{root}/")
    return reference if !mapping.key?(target_relative) &&
      (canonical || File.dirname(from) == File.dirname(to))
    target = File.join(root, mapping.fetch(target_relative, target_relative))
    new_path = if canonical
      target.delete_prefix("#{root}/")
    else
      Pathname.new(target).relative_path_from(Pathname.new(File.dirname(File.join(root, to)))).to_s
    end
    # Keep the original spelling/encoding of every unchanged trailing path
    # segment, including %20, Unicode, Markdown escapes and HTML entities.
    parts = new_path.split("/")
    original_parts = path.split("/")
    index = 1
    while index <= [parts.length, original_parts.length].min &&
        parts[-index] == decode_path(original_parts[-index])
      parts[-index] = original_parts[-index]
      index += 1
    end
    changed_count = parts.length - index + 1
    parts.first(changed_count).each_with_index do |part, position|
      parts[position] = URI::DEFAULT_PARSER.escape(part, /[^A-Za-z0-9\-._~!$&'()*+,;=:@]/)
    end
    rewritten = parts.join("/") + suffix.to_s
    wrapped ? "<#{rewritten}>" : rewritten
  rescue ArgumentError
    reference
  end

  def decode_path(value)
    URI::DEFAULT_PARSER.unescape(CGI.unescapeHTML(value).gsub(/\\([[:punct:]])/, '\1')).force_encoding(Encoding::UTF_8)
  end

  def rewrite_destinations(prose)
    # A full Markdown destination is matched before its angle brackets can
    # be mistaken for HTML. Complete tags also protect alt/title examples.
    pattern = /(?<html><(?:[^>"']|"[^"]*"|'[^']*')*>)|(?<prefix>(?<!\\)!?\[(?:\\.|[^\]\\\r\n])*\]\([ \t]*)(?<target>#{DESTINATION})|(?<definition>^ {0,3}\[(?:\\.|[^\]\\\r\n])+\]:[ \t]*)(?<defined_target>#{DESTINATION})/m
    prose.gsub(pattern) do |part|
      match = Regexp.last_match
      if match[:html]
        next part unless part.match?(/\A<(?:a|img|audio|video|source|track|object|embed)\b/i)
        part.gsub(/(\b(?:href|src|poster|data)\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i) do
          prefix, value = Regexp.last_match(1), Regexp.last_match(2)
          quote = value.start_with?('"', "'") ? value[0] : nil
          quote ? prefix + quote + yield(value[1...-1]) + quote : prefix + yield(value)
        end
      else
        (match[:prefix] || match[:definition]) + yield(match[:target] || match[:defined_target])
      end
    end
  end

  def rewrite_prose(content)
    # Protect frontmatter, fenced/indented code, inline code and HTML code
    # examples. Preserve line endings and BOM through substring replacement.
    prefix = content[/\A(?:\uFEFF)?---[ \t]*\r?\n.*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|\z)/m].to_s
    body = content[prefix.length..].to_s
    output = prefix.dup
    prose = +""
    fence = nil
    html_code = nil
    flush = proc do
      unless prose.empty?
        output << prose.gsub(/<(pre|code|script|style)\b[^>]*>.*?<\/\1\s*>|(`+).*?\2(?!`)|((?:(?!<(?:pre|code|script|style)\b|`).)+)|[\s\S]/mi) do |part|
          protected = part.start_with?("`") || part.match?(/\A<(?:pre|code|script|style)\b/i)
          protected ? part : yield(part)
        end
        prose.clear
      end
    end
    body.each_line do |line|
      # Container markers do not make fenced examples executable prose.
      probe = line.dup
      probe = probe.sub(/\A {0,3}>[ \t]?/, "") while probe.match?(/\A {0,3}>[ \t]?/)
      probe = probe.sub(/\A {0,3}(?:[-+*]|\d+[.)])[ \t]+/, "")
      marker = probe.match(/\A {0,3}(`{3,}|~{3,})/)
      html_start = probe.match(/\A[ \t]*<(pre|code|script|style)\b/i)
      if html_code
        output << line
        html_code = nil if probe.match?(/<\/#{html_code}\s*>/i)
      elsif fence
        output << line
        fence = nil if probe.match?(/\A {0,3}#{Regexp.escape(fence[0])}{#{fence.length},}[ \t]*(?:\r?\n|\z)/)
      elsif html_start
        flush.call
        output << line
        html_code = html_start[1] unless probe.match?(/<\/#{html_start[1]}\s*>/i)
      elsif marker || probe.match?(/\A(?: {4}|\t)/)
        flush.call
        output << line
        fence = marker[1] if marker
      else
        prose << line
      end
    end
    flush.call
    output
  end
end

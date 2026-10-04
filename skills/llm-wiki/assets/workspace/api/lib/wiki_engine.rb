# frozen_string_literal: true

require "date"
require "json"
require "set"

# WikiEngine — Three-layer file structure management
# Layer 1: raw/sources/ (original documents)
# Layer 2: wiki/ (generated knowledge pages)
# Layer 3: schema.md + purpose.md (project configuration)

module WikiEngine
  extend self

  # Page depth is independent from the type row shown above it in the UI.
  # Users may freely arrange a parent, child, and grandchild page.
  MAX_SIDEBAR_CONTENT_LEVEL = 3
  MAX_SIDEBAR_LEVELS = MAX_SIDEBAR_CONTENT_LEVEL + 1

  # Create a new wiki project with standard directory structure
  def create_project(root, name, template: "general", language: "")
    slug = slugify(name)
    path = File.join(root, slug)
    initialize_project(path, name, template: template, language: language)
  end

  # Initialize a wiki in an existing OpenClacky working directory. This is the
  # deterministic conversational fallback for users who start with Wiki
  # Assistant instead of opening the visual workspace first.
  def initialize_project(path, name, template: "general", language: "", provisional: false)
    FileUtils.mkdir_p(path)

    # Only infrastructure is deterministic. The onboarding agent creates the
    # actual taxonomy from the user's needs instead of pre-creating a fixed set
    # of empty content categories.
    %w[raw/sources wiki .llm-wiki].each do |dir|
      FileUtils.mkdir_p(File.join(path, dir))
    end

    # Default files (template-aware)
    write_if_missing(File.join(path, "purpose.md"), template_purpose(template, name))
    write_if_missing(File.join(path, "schema.md"), template_schema(template, language: language))
    log_path = File.join(path, ActivityLog::FILE)
    new_log = !File.exist?(log_path)
    write_if_missing(log_path, ActivityLog::HEADER)

    # Project metadata is the stable identity; the directory name is only a
    # storage slug and may be provisional during conversational onboarding.
    meta_path = File.join(path, ".llm-wiki", "project-meta.json")
    existing_meta = File.exist?(meta_path) ? (JSON.parse(File.read(meta_path)) rescue {}) : {}
    # Bootstrap is allowed to repair missing infrastructure, but it must never
    # turn a completed project back into an unfinished onboarding project. A
    # project without the legacy `provisional` key is completed as well.
    preserve_completed_metadata = !existing_meta.empty? &&
      existing_meta["provisional"] != true && provisional == true
    submitted_meta = {
      "name" => name,
      "language" => language,
      "template" => template,
      "provisional" => provisional == true,
      "format_version" => 2,
      "created_at" => existing_meta["created_at"] || Time.now.iso8601
    }
    meta = preserve_completed_metadata ? existing_meta.merge("created_at" => submitted_meta["created_at"]) : existing_meta.merge(submitted_meta)
    Storage.atomic_write(meta_path, JSON.pretty_generate(meta))
    ActivityLog.record(path, "project_initialized", "name=#{name}", actor: "system") if new_log

    project_info(path)
  end

  # Get project metadata
  def project_info(path)
    wiki_dir = File.join(path, "wiki")
    pages = Dir.glob(File.join(wiki_dir, "**", "*.md")) rescue []
    starter_pages = %w[index.md overview.md log.md].map { |name| File.join(wiki_dir, name) }
    knowledge_page_count = pages.reject { |page| starter_pages.include?(page) }.count
    page_count = knowledge_page_count
    source_count = (Dir.glob(File.join(path, "raw", "sources", "**", "*")).count { |entry| File.file?(entry) } rescue 0)

    meta_path = File.join(path, ".llm-wiki", "project-meta.json")
    meta = File.exist?(meta_path) ? (JSON.parse(File.read(meta_path)) rescue {}) : {}
    created_at = project_created_at(path).iso8601

    {
      "name" => meta["name"].to_s.strip.empty? ? File.basename(path).gsub("-", " ").split.map(&:capitalize).join(" ") : meta["name"],
      "path" => path,
      "template" => meta["template"] || "general",
      "language" => meta["language"] || "",
      "provisional" => meta["provisional"] == true,
      "hidden" => meta["hidden"] == true,
      "page_count" => page_count,
      "knowledge_page_count" => knowledge_page_count,
      "source_count" => source_count,
      "created_at" => created_at,
      "updated_at" => File.stat(path).mtime.iso8601
    }
  end

  # File::Stat#birthtime is available on macOS and some modern Linux
  # filesystems, but raises NotImplementedError on other Linux/WSL builds.
  # NotImplementedError is not a StandardError, so a bare rescue does not catch
  # it. Falling back explicitly keeps project discovery working everywhere.
  def project_created_at(path)
    stat = File.stat(path)
    stat.birthtime
  rescue NotImplementedError, SystemCallError
    File.stat(path).mtime
  end

  # Build file tree for wiki/ directory
  def file_tree(wiki_dir, base_path = nil, project_path: nil, type_aliases: nil)
    base_path ||= wiki_dir
    project_path ||= File.dirname(base_path)
    type_aliases ||= configured_type_aliases(project_path)
    entries = Dir.entries(wiki_dir).reject { |e| e.start_with?(".") }.sort
    entries.map do |entry|
      full = File.join(wiki_dir, entry)
      rel = full.sub("#{base_path}/", "")
      next if ActivityLog.hidden_page?(rel)
      if File.directory?(full)
        {
          "name" => entry,
          "path" => "wiki/#{rel}",
          "is_dir" => true,
          "children" => file_tree(
            full,
            base_path,
            project_path: project_path,
            type_aliases: type_aliases
          )
        }
      else
        item = { "name" => entry, "path" => "wiki/#{rel}", "is_dir" => false, "size" => File.size(full), "modified" => File.mtime(full).iso8601 }
        if File.extname(entry).downcase == ".md"
          content = File.read(full, encoding: "utf-8") rescue ""
          frontmatter = parse_frontmatter(content)
          item["type"] = canonical_page_type(
            project_path,
            frontmatter["type"],
            rel,
            aliases: type_aliases
          )
          item["title"] = extract_title(content, full)
          item["kind"] = frontmatter["kind"].to_s.strip unless frontmatter["kind"].to_s.strip.empty?
        end
        item
      end
    end.compact
  end

  # List source files
  def list_sources(project_path)
    source_dir = File.join(project_path, "raw", "sources")
    return [] unless Dir.exist?(source_dir)
    Dir.glob(File.join(source_dir, "**", "*")).select { |f| File.file?(f) }.map do |f|
      rel = f.sub("#{project_path}/", "")
      {
        "name" => File.basename(f),
        "path" => rel,
        "size" => File.size(f),
        "modified" => File.mtime(f).iso8601,
        "extension" => File.extname(f).downcase
      }
    end
  end

  # Parse YAML frontmatter from markdown content
  def parse_frontmatter(content)
    split_frontmatter(content).first
  end

  # Extract [[wikilinks]] from content
  def extract_wikilinks(content)
    content.scan(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/).flatten.map(&:strip)
  end

  def page_id(path, project_path = nil)
    value = path.to_s.tr("\\", "/")
    value = value.sub(%r{\A#{Regexp.escape(project_path.to_s.tr('\\', '/'))}/?}, "") unless project_path.to_s.empty?
    value.sub(%r{\Awiki/}, "").sub(/\.md\z/i, "")
  end

  def split_frontmatter(content)
    text = content.to_s
    document = frontmatter_document(text)
    return [{}, text] unless document
    [load_frontmatter_yaml(document[:yaml]), document[:body]]
  rescue
    [{}, text]
  end

  # Existing Markdown libraries commonly use a UTF-8 BOM and/or CRLF. Keep
  # the exact source boundaries so metadata-only edits never normalize the
  # rest of a user's file as a side effect.
  def frontmatter_document(content)
    text = content.to_s
    bom = text.start_with?("\uFEFF") ? "\uFEFF" : ""
    payload = bom.empty? ? text : text[1..].to_s
    match = payload.match(/\A---[ \t]*(\r?\n)(.*?)^---[ \t]*(?:\r?\n|\z)/m)
    return nil unless match
    yaml = match[2].to_s.sub(/\r?\n\z/, "")
    {
      bom: bom,
      payload: payload,
      match: match,
      yaml: yaml,
      eol: match[1],
      body: payload[match[0].length..].to_s
    }
  end

  # Unquoted ISO dates are valid YAML and are commonly emitted by agents.
  # Psych turns them into Date objects; rejecting Date made the entire
  # frontmatter silently disappear, including the page's title and type.
  def load_frontmatter_yaml(yaml)
    YAML.safe_load(yaml, permitted_classes: [Date, Time], aliases: true) || {}
  end

  def render_page(frontmatter, body)
    yaml = YAML.dump(frontmatter || {}).sub(/\A---\s*\n/, "---\n")
    "#{yaml}---\n\n#{body.to_s.sub(/\A\s+/, '').rstrip}\n"
  end

  # Change sidebar-facing metadata without moving the file. Keeping the path
  # stable preserves every existing wikilink while a drag changes only type.
  def update_page_metadata(content, title: nil, type: nil)
    updated = content.to_s
    if title
      clean_title = title.to_s.gsub(/[\r\n]+/, " ").strip
      updated = set_frontmatter_value(updated, "title", clean_title)
      updated = replace_first_heading(updated, clean_title)
    end
    if type
      clean_type = normalize_page_type(type)
      updated = set_frontmatter_value(updated, "type", clean_type)
    end
    updated
  end

  def set_frontmatter_value(content, key, value)
    text = content.to_s
    document = frontmatter_document(text)
    unless document
      bom = text.start_with?("\uFEFF") ? "\uFEFF" : ""
      payload = bom.empty? ? text : text[1..].to_s
      eol = payload.include?("\r\n") ? "\r\n" : "\n"
      return "#{bom}---#{eol}#{key}: #{JSON.generate(value)}#{eol}---#{eol}#{eol}#{payload}"
    end

    frontmatter = load_frontmatter_yaml(document[:yaml]) rescue {}
    return text if frontmatter[key].to_s == value.to_s

    raw_yaml = document[:match][2].to_s
    lines = raw_yaml.lines
    index = lines.index { |line| line.match?(/\A#{Regexp.escape(key)}[ \t]*:/) }
    replacement = "#{key}: #{JSON.generate(value)}#{document[:eol]}"
    if index
      old_value = lines[index].sub(/\A#{Regexp.escape(key)}[ \t]*:[ \t]*/, "").sub(/\r?\n\z/, "")
      finish = index + 1
      if old_value.match?(/\A[>|][+-]?[0-9]?(?:[ \t]+#.*)?[ \t]*\z/)
        finish += 1 while finish < lines.length && (lines[finish].strip.empty? || lines[finish].match?(/\A[ \t]+/))
      end
      lines[index...finish] = [replacement]
    else
      lines << document[:eol] unless lines.empty? || lines.last.end_with?("\n", "\r")
      lines << replacement
    end

    yaml = lines.join
    before_yaml = document[:match][0][0...document[:match].begin(2)]
    after_yaml = document[:match][0][document[:match].end(2)..].to_s
    prefix = "#{before_yaml}#{yaml}#{after_yaml}"
    "#{document[:bom]}#{prefix}#{document[:body]}"
  end

  def replace_first_heading(content, title)
    text = content.to_s
    document = frontmatter_document(text)
    return text.sub(/^#\s+[^\r\n]+/, "# #{title}") unless document
    body = document[:body].sub(/^#\s+[^\r\n]+/, "# #{title}")
    "#{document[:bom]}#{document[:match][0]}#{body}"
  end

  def normalize_page_type(value)
    value.to_s.strip.downcase.gsub(/\s+/, "-").then { |type| type.empty? ? "other" : type }
  end

  # Graph config has existed in two compatible shapes (`labels`/`display` and
  # `types`/`label`). Treat both the stable id and its display label as aliases,
  # but never let a display label shadow another configured id.
  def configured_type_aliases(project_path)
    path = File.join(project_path, ".llm-wiki", "graph-config.json")
    stored = File.file?(path) ? (JSON.parse(File.read(path, encoding: "utf-8")) rescue {}) : {}
    legacy_types = stored["labels"].is_a?(Hash) ? stored["labels"] : {}
    canonical_types = stored["types"].is_a?(Hash) ? stored["types"] : {}
    entries = legacy_types.merge(canonical_types).select { |_, value| value.is_a?(Hash) }
    aliases = {}
    entries.each_key do |id|
      canonical = normalize_page_type(id)
      aliases[canonical] = canonical
    end
    entries.each do |id, value|
      canonical = normalize_page_type(id)
      label = value["label"].to_s.strip
      label = value["display"].to_s.strip if label.empty?
      aliases[normalize_page_type(label)] ||= canonical unless label.empty?
    end
    aliases
  end

  def canonical_page_type(project_path, frontmatter_type, relative_path, aliases: nil)
    aliases ||= configured_type_aliases(project_path)
    explicit = frontmatter_type.to_s.strip
    return aliases.fetch(normalize_page_type(explicit), normalize_page_type(explicit)) unless explicit.empty?

    # A configured id or display label may itself be the storage directory.
    # Check that exact alias before applying the historical plural fallback.
    parts = relative_path.to_s.tr("\\", "/").sub(%r{\Awiki/}, "").split("/")
    if parts.length > 1
      directory = normalize_page_type(parts.first)
      return aliases[directory] if aliases.key?(directory)
    end

    inferred = normalize_page_type(page_type(nil, relative_path))
    aliases.fetch(inferred, inferred)
  end

  def canonical_page_type_id(project_path, value, aliases: nil)
    aliases ||= configured_type_aliases(project_path)
    normalized = normalize_page_type(value)
    aliases.fetch(normalized, normalized)
  end

  # Resolve a wikilink to a canonical page id. Bare basenames are accepted only
  # when they identify exactly one page, so duplicate slugs never guess wrong.
  def page_id_lookup(page_ids)
    ids = page_ids.to_a
    exact = {}
    basenames = Hash.new { |hash, key| hash[key] = [] }
    ids.each do |id|
      exact[id.downcase] ||= id
      basenames[File.basename(id).downcase] << id
    end
    { ids: ids, exact: exact, basenames: basenames }
  end

  def resolve_page_id(raw_target, page_ids, from_id: nil, lookup: nil)
    target = page_id(raw_target.to_s.split("#", 2).first).strip
    return nil if target.empty?
    ids = lookup ? lookup[:ids] : page_ids.to_a
    exact = lookup ? lookup[:exact][target.downcase] : ids.find { |id| id.casecmp(target).zero? }
    return exact if exact

    if from_id && !target.include?("/")
      sibling = File.join(File.dirname(from_id), target).sub(%r{\A\./}, "")
      match = lookup ? lookup[:exact][sibling.downcase] : ids.find { |id| id.casecmp(sibling).zero? }
      return match if match
    end

    basename = File.basename(target).downcase
    matches = lookup ? lookup[:basenames][basename] : ids.select { |id| File.basename(id).downcase == basename }
    matches.one? ? matches.first : nil
  end

  # Slugify a string for use as filename
  def slugify(text)
    text.downcase
        .gsub(/[^\p{L}\p{N}\s-]/u, "")
        .gsub(/[\s_]+/, "-")
        .gsub(/-+/, "-")
        .sub(/^-/, "")
        .sub(/-$/, "")
        .then { |s| s.empty? ? "untitled-#{SecureRandom.hex(4)}" : s }
  end

  # Extract title from page content
  def extract_title(content, fallback_path = "")
    fm = parse_frontmatter(content)
    return fm["title"] if fm["title"].is_a?(String) && !fm["title"].strip.empty?
    heading = content.match(/^#\s+([^\r\n]+)$/)
    return heading[1].strip if heading
    File.basename(fallback_path, ".md").gsub(/[-_]/, " ")
  end

  # Page trees must expose the same real type used by graph/search. Older UI
  # guessed from a short fixed directory list, which collapsed every custom or
  # domain-specific type into "other".
  def page_type(frontmatter_type, relative_path)
    explicit = frontmatter_type.to_s.strip.downcase.gsub(/\s+/, "-")
    return explicit unless explicit.empty?

    parts = relative_path.to_s.split("/")
    if parts.length < 2
      root_name = File.basename(parts.first.to_s, ".md").downcase
      return root_name if %w[index overview log].include?(root_name)
      return "other"
    end
    directory = parts.first.downcase
    directory.sub(/ies\z/, "y").sub(/s\z/, "")
  end

  # The sidebar's type row is structural UI, not page depth. Content below it
  # may occupy three real page levels (parent, child, and grandchild). Existing
  # deeper files remain readable; this helper is used only to reject newly
  # created or moved level-four content. Directory names are real visible
  # category nodes, while index.md is the landing page for its directory.
  def sidebar_content_depth(
    relative_path,
    explicit_type = nil,
    project_path: nil,
    excluding_paths: [],
    additional_paths: []
  )
    parts = page_id(relative_path).split("/").reject(&:empty?)
    parts.pop if parts.last.to_s.casecmp("index").zero?
    if project_path
      storage_root = sidebar_storage_root(
        project_path,
        explicit_type,
        excluding_paths: excluding_paths,
        additional_paths: Array(additional_paths) + [relative_path]
      )
      parts.shift if storage_root && parts.first.to_s.casecmp(storage_root).zero?
    else
      type = normalize_page_type(explicit_type)
      if parts.any? && sidebar_type_token(parts.first) == sidebar_type_token(type)
        parts.shift
      end
    end
    [parts.length, 1].max
  end

  # A physical first directory is a storage root only when every page of the
  # canonical type has more than one path segment and shares that directory.
  # This mirrors the browser tree and, importantly, does not assume that the
  # directory name is an English plural of the type id.
  def sidebar_storage_root(project_path, explicit_type, excluding_paths: [], additional_paths: [])
    aliases = configured_type_aliases(project_path)
    canonical_type = canonical_page_type_id(project_path, explicit_type, aliases: aliases)
    excluded = Array(excluding_paths).map { |path| normalized_wiki_page_path(path).downcase }.to_set
    paths = []
    wiki_dir = File.join(project_path, "wiki")
    Dir.glob(File.join(wiki_dir, "**", "*.md")).each do |file|
      relative = file.sub("#{wiki_dir}/", "")
      wiki_path = "wiki/#{relative}"
      next if excluded.include?(wiki_path.downcase)
      content = File.read(file, encoding: "utf-8") rescue next
      frontmatter = parse_frontmatter(content)
      next unless canonical_page_type(project_path, frontmatter["type"], relative, aliases: aliases) == canonical_type
      paths << wiki_path
    end
    paths.concat(Array(additional_paths).map { |path| normalized_wiki_page_path(path) })
    paths.reject! { |path| excluded.include?(path.downcase) }
    paths.uniq!
    return nil if paths.empty?

    segmented = paths.map { |path| page_id(path).split("/").reject(&:empty?) }
    return nil unless segmented.all? { |parts| parts.length > 1 }
    root = segmented.first.first
    segmented.all? { |parts| parts.first.to_s.casecmp(root).zero? } ? root : nil
  end

  def sidebar_child_directory(relative_path)
    stem = page_id(relative_path)
    return File.dirname(stem).sub(/\A\.\z/, "") if File.basename(stem).casecmp("index").zero?
    stem
  end

  def sidebar_parent_directory(relative_path)
    path = normalized_wiki_page_path(relative_path)
    if File.basename(path).casecmp("index.md").zero?
      File.dirname(File.dirname(path)).sub(/\A\.\z/, "")
    else
      File.dirname(path).sub(/\A\.\z/, "")
    end
  end

  def sidebar_logical_counterpart(relative_path)
    path = normalized_wiki_page_path(relative_path)
    if File.basename(path).casecmp("index.md").zero?
      "#{File.dirname(path)}.md"
    else
      "#{path.sub(/\.md\z/i, '')}/index.md"
    end
  end

  def sidebar_logical_conflict?(project_path, relative_path, excluding_paths: [])
    excluded = Array(excluding_paths).map { |path| normalized_wiki_page_path(path).downcase }.to_set
    counterpart = sidebar_logical_counterpart(relative_path)
    return false if excluded.include?(counterpart.downcase)
    File.file?(File.join(project_path, counterpart))
  end

  def sidebar_descendant_pages(project_path, relative_path)
    full = File.expand_path(File.join(project_path, relative_path))
    root = if File.basename(full).casecmp("index.md").zero?
      # `<type-directory>/index.md` is the landing article directly beneath
      # the top-level type row, not the parent of every sibling article in
      # that type. Nested index pages are real category landing pages.
      content = File.read(full, encoding: "utf-8") rescue ""
      frontmatter = parse_frontmatter(content)
      type = canonical_page_type(project_path, frontmatter["type"], relative_path.sub(%r{\Awiki/}, ""))
      directory = File.dirname(page_id(relative_path))
      directory_parts = directory.split("/").reject { |part| part == "." || part.empty? }
      storage_root = sidebar_storage_root(project_path, type)
      return [] if directory_parts.length == 1 && storage_root &&
        directory_parts.first.casecmp(storage_root).zero?
      File.dirname(full)
    else
      full.sub(/\.md\z/i, "")
    end
    return [] unless Dir.exist?(root)
    Dir.glob(File.join(root, "**", "*.md")).reject { |path| File.expand_path(path) == full }
  end

  private

  def normalized_wiki_page_path(value)
    path = value.to_s.tr("\\", "/").sub(%r{\A/+}, "")
    path.start_with?("wiki/") ? path : "wiki/#{path}"
  end

  def sidebar_type_token(value)
    normalize_page_type(value).sub(/ies\z/, "y").sub(/s\z/, "")
  end

  def write_if_missing(path, content)
    return if File.exist?(path)
    Storage.atomic_write(path, content, encoding: "utf-8")
  end

  def template_extra_dirs(template)
    case template
    when "research" then %w[wiki/methodology wiki/findings wiki/thesis]
    when "reading"  then %w[wiki/characters wiki/themes wiki/plot-threads wiki/chapters]
    when "personal" then %w[wiki/goals wiki/habits wiki/reflections wiki/journal]
    when "business" then %w[wiki/meetings wiki/decisions wiki/projects wiki/stakeholders]
    else []
    end
  end

  def template_purpose(template, name)
    case template
    when "research"
      <<~MD
        # Project Purpose — Research

        ## Research Question
        > (State the central question this wiki aims to answer)

        ## Hypothesis
        > (Your current best guess — update as evidence accumulates)

        ## Sub-questions
        1.
        2.
        3.

        ## Scope
        **In scope:**
        -

        **Out of scope:**
        -

        ## Success Criteria
        - How will you know when you have a satisfying answer?
      MD
    when "reading"
      <<~MD
        # Project Purpose — Reading

        ## Book Details
        **Title:** #{name}
        **Author:**
        **Genre:**

        ## Why I'm Reading This
        >

        ## Key Themes to Track
        1.
        2.
        3.

        ## Questions Going In
        1.
        2.
      MD
    when "personal"
      <<~MD
        # Project Purpose — Personal Growth

        ## Focus Areas
        1.
        2.
        3.

        ## Current Goals
        - [ ]
        - [ ]

        ## Review Cadence
        - Daily journal: Yes / No
        - Weekly reflection:
        - Monthly reflection:

        ## Guiding Principles
        1.
        2.
      MD
    when "business"
      <<~MD
        # Project Purpose — Business

        ## Context
        **Team:** #{name}
        **Domain:**

        ## Objectives
        1.
        2.
        3.

        ## Key Stakeholders
        -
        -

        ## Review Cadence
        - Weekly sync:
        - Monthly status:
        - Quarterly retro:
      MD
    else
      default_purpose(name)
    end
  end

  def template_schema(template, language: "")
    chinese = language.to_s.match?(/中文|汉语|Chinese|\Azh(?:[-_]|\z)/i)
    title = chinese ? "笔记约定" : "Note conventions"
    types = chinese ? "按实际内容增加分类，不预先创建空目录或空笔记。" : "Add categories when the content needs them. No empty categories or notes are required."
    metadata = chinese ? "用 YAML 保存标题、来源和创建日期。分类有需要时再添加；更新笔记时保留已有字段。" : "Use YAML for the title, sources and creation date. Add a type when useful; preserve existing fields when updating notes."
    links = chinese ? "链接使用相对 wiki 目录的路径，例如 [[decisions/example]]，省略开头的 wiki/ 和末尾的 .md。保留来源位置；不确定的内容标明待确认。" : "Link with paths relative to wiki, such as [[decisions/example]], without the leading wiki/ or trailing .md. Retain source locations and mark uncertain claims."
    <<~MD
      # #{title}

      #{types}

      #{metadata}

      ```yaml
      ---
      title: "#{chinese ? '笔记标题' : 'Note title'}"
      sources: []
      created: YYYY-MM-DD
      ---
      ```

      #{links}
    MD
  end

  def default_purpose(name)
    "# #{name}\n\n"
  end

  def default_schema
    <<~MD
      # Schema

      ## Page Types

      ### entity
      A person, organization, product, or named thing.
      Frontmatter: `type: entity`

      ### concept
      An idea, method, theory, or abstract topic.
      Frontmatter: `type: concept`

      ### source
      A summary of an ingested source document.
      Frontmatter: `type: source`
      Location: `wiki/sources/`

      ### query
      A research query result or synthesized answer.
      Frontmatter: `type: query`
      Location: `wiki/queries/`

      ### synthesis
      A page that combines multiple sources/concepts.
      Frontmatter: `type: synthesis`

      ## File Structure Rules
      - All wiki pages use canonical `[[directory/page-slug]]` targets for cross-references
      - Include the directory; omit only the leading `wiki/` and trailing `.md`
      - Frontmatter must include `type` and `title`
      - Sources list in frontmatter tracks provenance
      - Use descriptive slug-based filenames
    MD
  end
end

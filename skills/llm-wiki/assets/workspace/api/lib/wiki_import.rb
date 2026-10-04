# frozen_string_literal: true

# Recognize Markdown-based wiki folders and load them into an LLM Wiki project
# without changing the source folder. Standard LLM Wiki projects are opened in
# place; Obsidian, Quartz, Docusaurus and generic Markdown folders are copied
# into the extension's managed knowledge-base directory.
module WikiImport
  extend self

  MAX_FILES = 10_000
  MAX_ASSET_BYTES = 50 * 1024 * 1024
  COPY_EXTENSIONS = %w[.md .markdown .png .jpg .jpeg .gif .webp .svg .pdf .mp3 .m4a .wav .mp4 .mov].freeze
  IGNORED_PARTS = %w[.git .svn node_modules .obsidian .trash .cache dist build].freeze

  def inspect_folder(input_path)
    path = normalize_path(input_path)
    raise ArgumentError, "Project path is required" if path.empty?
    raise ArgumentError, "Project not found" unless Dir.exist?(path)

    if llm_wiki?(path)
      project = WikiEngine.project_info(path)
      return {
        "path" => path,
        "name" => project["name"],
        "kind" => "llm-wiki",
        "kind_label" => "LLM Wiki",
        "markdown_count" => markdown_files(path).size,
        "compatible" => true,
        "requires_import" => false,
        "project" => project
      }
    end

    markdown = markdown_files(path)
    raise ArgumentError, "No Markdown wiki found" if markdown.empty?
    raise ArgumentError, "Wiki contains too many files" if markdown.size > MAX_FILES

    kind, label = detect_kind(path)
    {
      "path" => path,
      "name" => File.basename(path),
      "kind" => kind,
      "kind_label" => label,
      "markdown_count" => markdown.size,
      "asset_count" => importable_files(path).count { |file| File.extname(file).downcase != ".md" && File.extname(file).downcase != ".markdown" },
      "compatible" => true,
      "requires_import" => true
    }
  end

  def load_folder(input_path, projects_root)
    info = inspect_folder(input_path)
    return { "project" => info["project"], "inspection" => info, "imported" => false, "created" => false } unless info["requires_import"]

    source = info["path"]
    existing = find_existing_import(projects_root, source)
    if existing
      return {
        "project" => WikiEngine.project_info(existing),
        "inspection" => info,
        "imported" => true,
        "created" => false,
        "already_loaded" => true
      }
    end

    FileUtils.mkdir_p(projects_root)
    destination = unique_destination(projects_root, info["name"])
    created = false
    begin
      WikiEngine.initialize_project(destination, info["name"], template: "general", language: "", provisional: false)
      created = true
      copy_wiki_files(source, destination)
      write_import_metadata(destination, source, info)
      {
        "project" => WikiEngine.project_info(destination),
        "inspection" => info,
        "imported" => true,
        "created" => true,
        "already_loaded" => false
      }
    rescue StandardError
      FileUtils.rm_rf(destination) if created && managed_child?(destination, projects_root)
      raise
    end
  end

  def normalize_path(input_path)
    value = input_path.to_s.strip
    return "" if value.empty?
    value = value.sub(/\A~(?=\/|\z)/, Dir.home)
    File.expand_path(value)
  end

  private

  def llm_wiki?(path)
    Dir.exist?(File.join(path, "wiki")) &&
      File.file?(File.join(path, "schema.md")) &&
      File.file?(File.join(path, "purpose.md"))
  end

  def detect_kind(path)
    return ["obsidian", "Obsidian"] if Dir.exist?(File.join(path, ".obsidian"))
    return ["quartz", "Quartz"] if File.file?(File.join(path, "quartz.config.ts")) || Dir.exist?(File.join(path, "quartz"))
    docusaurus = Dir.glob(File.join(path, "docusaurus.config.*")).any?
    return ["docusaurus", "Docusaurus"] if docusaurus
    ["markdown", "Markdown Wiki"]
  end

  def markdown_files(path)
    Dir.glob(File.join(path, "**", "*.{md,markdown}"), File::FNM_CASEFOLD).select do |file|
      File.file?(file) && importable_relative_path?(file.sub(%r{\A#{Regexp.escape(path)}/?}, ""))
    end.first(MAX_FILES + 1)
  end

  def importable_files(path)
    Dir.glob(File.join(path, "**", "*"), File::FNM_DOTMATCH).select do |file|
      next false unless File.file?(file)
      relative = file.sub(%r{\A#{Regexp.escape(path)}/?}, "")
      next false unless importable_relative_path?(relative)
      COPY_EXTENSIONS.include?(File.extname(file).downcase) && File.size(file) <= MAX_ASSET_BYTES
    rescue SystemCallError
      false
    end.first(MAX_FILES)
  end

  def importable_relative_path?(relative)
    parts = relative.to_s.tr("\\", "/").split("/")
    !parts.empty? && parts.none? { |part| IGNORED_PARTS.include?(part) }
  end

  def copy_wiki_files(source, destination)
    wiki_root = File.join(destination, "wiki")
    importable_files(source).each do |source_file|
      relative = source_file.sub(%r{\A#{Regexp.escape(source)}/?}, "").tr("\\", "/")
      relative = relative.sub(%r{\Awiki/}i, "")
      next if relative.empty?
      target = File.expand_path(File.join(wiki_root, relative))
      next unless target.start_with?("#{File.expand_path(wiki_root)}/")
      FileUtils.mkdir_p(File.dirname(target))
      if %w[.md .markdown].include?(File.extname(source_file).downcase)
        content = File.binread(source_file).force_encoding(Encoding::UTF_8).scrub
        target = target.sub(/\.markdown\z/i, ".md")
        Storage.atomic_write(target, content, encoding: "utf-8")
      else
        FileUtils.cp(source_file, target)
      end
    end
  end

  def unique_destination(root, name)
    slug = WikiEngine.slugify(name)
    candidate = File.join(root, slug)
    return candidate unless File.exist?(candidate)
    index = 2
    loop do
      candidate = File.join(root, "#{slug}-#{index}")
      return candidate unless File.exist?(candidate)
      index += 1
    end
  end

  def find_existing_import(root, source)
    expanded = File.expand_path(source)
    Dir.glob(File.join(root, "*", ".llm-wiki", "project-meta.json")).find do |meta_path|
      meta = JSON.parse(File.read(meta_path, encoding: "utf-8")) rescue {}
      meta["imported_from"].to_s == expanded && llm_wiki?(File.dirname(File.dirname(meta_path)))
    end&.then { |meta_path| File.dirname(File.dirname(meta_path)) }
  end

  def write_import_metadata(destination, source, info)
    meta_path = File.join(destination, ".llm-wiki", "project-meta.json")
    meta = JSON.parse(File.read(meta_path, encoding: "utf-8"))
    meta["imported_from"] = File.expand_path(source)
    meta["import_kind"] = info["kind"]
    meta["imported_at"] = Time.now.iso8601
    meta["imported_markdown_count"] = info["markdown_count"]
    Storage.atomic_write(meta_path, JSON.pretty_generate(meta), encoding: "utf-8")
  end

  def managed_child?(path, root)
    File.expand_path(path).start_with?("#{File.expand_path(root)}/")
  end
end

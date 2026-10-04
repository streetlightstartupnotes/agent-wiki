# frozen_string_literal: true

require_relative "relative_references"

# CascadeDelete — recoverable leaf deletion and path-aware moves.
#
# Canonical ids are wiki-relative paths without `.md`. Bare links are only
# resolved when unique, so duplicate filenames in different folders are safe.
module CascadeDelete
  extend self

  class TrashUnavailableError < StandardError; end

  def delete_page(project_path, rel_path, trash_dir: nil)
    project_path = utf8_path(project_path, "project path")
    rel_path = utf8_path(rel_path, "wiki page path")
    trash_dir = utf8_path(trash_dir, "trash directory") unless trash_dir.nil?
    project_lock(project_path) { delete_page_without_lock(project_path, rel_path, trash_dir: trash_dir) }
  end

  def delete_page_without_lock(project_path, rel_path, trash_dir: nil)
    full_path = File.expand_path(File.join(project_path, rel_path))
    return { "ok" => false, "error" => "File not found" } unless File.file?(full_path)

    descendants = WikiEngine.sidebar_descendant_pages(project_path, rel_path)
    if descendants.any?
      return {
        "ok" => false,
        "status" => 409,
        "error" => "Remove or move child items before deleting this parent",
        "children" => descendants.map { |path| path.sub("#{project_path}/", "") }
      }
    end

    receipt = move_to_recoverable_trash(project_path, full_path, trash_dir: trash_dir)
    best_effort_prune_empty_dirs(File.dirname(full_path), File.join(project_path, "wiki"))

    {
      "ok" => true,
      "deleted" => rel_path,
      "trashed" => true,
      "trash_file" => receipt["trash_file"],
      "original_path" => full_path,
      # Inbound wikilinks intentionally stay untouched. Restoring the original
      # page makes them valid again without rewriting any other document.
      "removed_links" => 0,
      "cleaned_files" => []
    }
  end

  def move_page(project_path, from_rel, to_rel)
    project_path = utf8_path(project_path, "project path")
    from_rel = utf8_path(from_rel, "source wiki page path")
    to_rel = utf8_path(to_rel, "destination wiki page path")
    project_lock(project_path) { move_page_without_lock(project_path, from_rel, to_rel) }
  end

  # Move a sidebar page and every page nested beneath it as one logical tree.
  # Each Markdown file is moved explicitly instead of renaming a directory so
  # a storage-root index page never accidentally takes unrelated siblings with
  # it. Wikilinks and page types are updated against one old-to-new id map.
  def move_page_tree(project_path, from_rel, to_rel, target_type: nil)
    project_path = utf8_path(project_path, "project path")
    from_rel = utf8_path(from_rel, "source wiki page path")
    to_rel = utf8_path(to_rel, "destination wiki page path")
    project_lock(project_path) do
      move_page_tree_without_lock(project_path, from_rel, to_rel, target_type: target_type)
    end
  end

  def move_page_without_lock(project_path, from_rel, to_rel)
    wiki_dir = File.join(project_path, "wiki")
    source = File.expand_path(File.join(project_path, from_rel))
    destination = File.expand_path(File.join(project_path, to_rel))
    from_id = WikiEngine.page_id(from_rel)
    to_id = WikiEngine.page_id(to_rel)
    files = wiki_files(wiki_dir)
    page_ids = files.map { |file| WikiEngine.page_id(file.sub("#{wiki_dir}/", "")) }.to_set
    moved_page_ids = page_ids.dup
    moved_page_ids.delete(from_id)
    moved_page_ids.add(to_id)
    changes = {}
    updated_links = 0

    # Preserve links owned by the moved page itself. A bare sibling link such
    # as [[other]] may stop resolving after the page changes folders, so only
    # those context-dependent links are expanded to their canonical ids.
    source_content = File.read(source, encoding: "utf-8")
    moved_content = rewrite_links(source_content) do |raw_target, display|
      old_target = WikiEngine.resolve_page_id(raw_target, page_ids, from_id: from_id)
      next nil unless old_target
      new_target = WikiEngine.resolve_page_id(raw_target, moved_page_ids, from_id: to_id)
      replacement = old_target == from_id ? to_id : (new_target == old_target ? nil : old_target)
      next nil unless replacement
      updated_links += 1
      display.to_s.empty? ? "[[#{replacement}]]" : "[[#{replacement}|#{display}]]"
    end
    moved_content = RelativeReferences.rebase(moved_content, project_path: project_path,
      from: from_rel, to: to_rel, mapping: { from_rel => to_rel }) { updated_links += 1 }
    changes[source] = moved_content if moved_content != source_content

    files.each do |file|
      next if File.expand_path(file) == source
      original = File.read(file, encoding: "utf-8") rescue next
      owner_id = WikiEngine.page_id(file.sub("#{wiki_dir}/", ""))
      updated = rewrite_links(original) do |raw_target, display|
        resolved = WikiEngine.resolve_page_id(raw_target, page_ids, from_id: owner_id)
        next nil unless resolved == from_id
        updated_links += 1
        display.to_s.empty? ? "[[#{to_id}]]" : "[[#{to_id}|#{display}]]"
      end
      changes[file] = updated if updated != original
    end

    FileUtils.mkdir_p(File.dirname(destination))
    apply_transaction(changes) { File.rename(source, destination) }
    prune_empty_dirs(File.dirname(source), wiki_dir)

    {
      "ok" => true,
      "from" => from_rel,
      "to" => to_rel,
      "updated_links" => updated_links,
      "cleaned_files" => changes.keys.map { |file| file.sub("#{project_path}/", "") }
    }
  end

  def move_page_tree_without_lock(project_path, from_rel, to_rel, target_type: nil)
    wiki_dir = File.join(project_path, "wiki")
    source = File.expand_path(File.join(project_path, from_rel))
    raise ArgumentError, "File not found" unless File.file?(source)

    descendants = WikiEngine.sidebar_descendant_pages(project_path, from_rel).map do |path|
      "wiki/#{path.sub("#{wiki_dir}/", "")}"
    end
    moved_paths = [from_rel, *descendants].uniq
    old_child_root = "wiki/#{WikiEngine.sidebar_child_directory(from_rel)}"
    new_child_root = "wiki/#{WikiEngine.sidebar_child_directory(to_rel)}"
    mapping = moved_paths.each_with_object({}) do |path, result|
      result[path] = if path == from_rel
        to_rel
      elsif path.start_with?("#{old_child_root}/")
        path.sub(old_child_root, new_child_root)
      else
        raise ArgumentError, "Invalid sidebar subtree"
      end
    end

    old_full_paths = mapping.keys.map { |path| File.expand_path(File.join(project_path, path)) }.to_set
    mapping.each_value do |destination_path|
      destination = File.expand_path(File.join(project_path, destination_path))
      if File.exist?(destination) && !old_full_paths.include?(destination)
        raise ArgumentError, "Destination already exists"
      end
      if WikiEngine.sidebar_logical_conflict?(project_path, destination_path, excluding_paths: mapping.keys)
        raise ArgumentError, "A page already uses the same sidebar location"
      end
    end

    files = wiki_files(wiki_dir)
    old_ids = files.map { |file| WikiEngine.page_id(file.sub("#{wiki_dir}/", "")) }.to_set
    id_mapping = mapping.each_with_object({}) do |(old_path, new_path), result|
      result[WikiEngine.page_id(old_path)] = WikiEngine.page_id(new_path)
    end
    new_ids = old_ids.each_with_object(Set.new) { |id, set| set.add(id_mapping.fetch(id, id)) }
    changes = {}
    updated_links = 0

    files.each do |file|
      relative = "wiki/#{file.sub("#{wiki_dir}/", "")}"
      old_owner = WikiEngine.page_id(relative)
      new_owner = id_mapping.fetch(old_owner, old_owner)
      original = File.read(file, encoding: "utf-8")
      updated = if mapping.key?(relative) && !target_type.to_s.strip.empty?
        WikiEngine.update_page_metadata(original, type: target_type)
      else
        original
      end
      updated = rewrite_links(updated) do |raw_target, display|
        resolved = WikiEngine.resolve_page_id(raw_target, old_ids, from_id: old_owner)
        next nil unless resolved
        intended = id_mapping.fetch(resolved, resolved)
        replacement = id_mapping.key?(resolved) ? intended : nil
        if replacement.nil? && mapping.key?(relative)
          new_target = WikiEngine.resolve_page_id(raw_target, new_ids, from_id: new_owner)
          replacement = intended if new_target != intended
        end
        next nil unless replacement
        updated_links += 1
        display.to_s.empty? ? "[[#{replacement}]]" : "[[#{replacement}|#{display}]]"
      end
      if mapping.key?(relative)
        updated = RelativeReferences.rebase(updated, project_path: project_path,
          from: relative, to: mapping[relative], mapping: mapping) { updated_links += 1 }
      end
      changes[file] = updated if updated != original
    end

    originals = changes.transform_values { nil }
    moved_files = []
    begin
      changes.each_key { |path| originals[path] = File.read(path, encoding: "utf-8") }
      changes.each { |path, content| Storage.atomic_write(path, content, encoding: "utf-8") }
      mapping.sort_by { |old_path, _| -old_path.count("/") }.each do |old_path, new_path|
        next if old_path == new_path
        old_full = File.expand_path(File.join(project_path, old_path))
        new_full = File.expand_path(File.join(project_path, new_path))
        FileUtils.mkdir_p(File.dirname(new_full))
        File.rename(old_full, new_full)
        moved_files << [old_full, new_full]
      end
    rescue
      moved_files.reverse_each do |old_full, new_full|
        FileUtils.mkdir_p(File.dirname(old_full))
        File.rename(new_full, old_full) if File.exist?(new_full) && !File.exist?(old_full)
      end
      originals.each { |path, content| Storage.atomic_write(path, content, encoding: "utf-8") rescue nil }
      raise
    end

    mapping.each_key do |old_path|
      best_effort_prune_empty_dirs(File.dirname(File.join(project_path, old_path)), wiki_dir)
    end
    cleaned = changes.keys.map do |file|
      relative = "wiki/#{file.sub("#{wiki_dir}/", "")}"
      mapping.fetch(relative, relative)
    end

    {
      "ok" => true,
      "from" => from_rel,
      "to" => to_rel,
      "moved_paths" => mapping,
      "updated_links" => updated_links,
      "cleaned_files" => cleaned
    }
  end

  private :delete_page_without_lock, :move_page_without_lock, :move_page_tree_without_lock

  private

  def wiki_files(wiki_dir)
    Dir.glob(File.join(wiki_dir, "**", "*.md"))
  end

  # A block may return:
  # - nil: preserve the original link
  # - a string beginning with [[ : replace with that complete wikilink
  # - any other string: replace the link with plain display text
  def rewrite_links(content)
    content.gsub(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/) do |match|
      replacement = yield(Regexp.last_match(1).strip, Regexp.last_match(2))
      replacement.nil? ? match : replacement
    end
  end

  def project_lock(project_path, &block)
    Storage.with_lock(File.join(project_path, ".llm-wiki", "write.lock"), &block)
  end

  def move_to_recoverable_trash(project_path, full_path, trash_dir: nil)
    project_path = utf8_path(project_path, "project path")
    full_path = utf8_path(full_path, "wiki page path")
    destination_root = utf8_path(trash_dir || openclacky_trash_dir(project_path), "trash directory")
    FileUtils.mkdir_p(destination_root)
    stat = File.stat(full_path)
    timestamp = Time.now.utc.strftime("%Y%m%d_%H%M%S_%6N")
    destination = File.join(
      destination_root,
      "#{File.basename(full_path)}_deleted_#{timestamp}_#{SecureRandom.hex(4)}"
    )
    metadata_path = "#{destination}.metadata.json"
    FileUtils.mv(full_path, destination)
    metadata = {
      "original_path" => full_path,
      "trash_directory" => destination_root,
      "deleted_at" => Time.now.utc.iso8601,
      "deleted_by" => "llm-wiki",
      "file_size" => stat.size,
      "file_type" => File.extname(full_path),
      "file_mode" => (stat.mode & 0o777).to_s(8)
    }
    Storage.atomic_write(metadata_path, JSON.generate(metadata), encoding: "utf-8")
    { "trash_file" => destination, "metadata_path" => metadata_path }
  rescue
    FileUtils.mv(destination, full_path) if destination && File.exist?(destination) && !File.exist?(full_path)
    File.delete(metadata_path) if metadata_path && File.exist?(metadata_path)
    raise
  end

  def openclacky_trash_dir(project_path)
    project_path = utf8_path(project_path, "project path")
    if defined?(Clacky::TrashDirectory)
      return utf8_path(Clacky::TrashDirectory.new(project_path).trash_dir, "trash directory")
    end
    begin
      require "clacky/utils/trash_directory"
    rescue LoadError => error
      raise TrashUnavailableError, "OpenClacky recoverable trash is unavailable: #{error.message}"
    end
    unless defined?(Clacky::TrashDirectory)
      raise TrashUnavailableError, "OpenClacky recoverable trash is unavailable"
    end
    utf8_path(Clacky::TrashDirectory.new(project_path).trash_dir, "trash directory")
  end

  def apply_transaction(changes)
    originals = changes.transform_values { |content| nil }
    changes.each_key { |path| originals[path] = File.read(path, encoding: "utf-8") }
    changes.each { |path, content| Storage.atomic_write(path, content, encoding: "utf-8") }
    yield
  rescue
    originals&.each { |path, content| Storage.atomic_write(path, content, encoding: "utf-8") rescue nil }
    raise
  end

  def prune_empty_dirs(dir, wiki_dir)
    current = dir
    while current != wiki_dir && Dir.exist?(current) && Dir.empty?(current)
      Dir.rmdir(current)
      current = File.dirname(current)
    end
  end

  def best_effort_prune_empty_dirs(dir, wiki_dir)
    prune_empty_dirs(dir, wiki_dir)
  rescue StandardError
    false
  end

  # WEBrick and older callers can tag valid UTF-8 filesystem bytes as
  # ASCII-8BIT. Retag those exact bytes without transcoding them. Other
  # encodings are transcoded normally, while malformed byte sequences fail
  # before a file is moved so recoverability is never ambiguous.
  def utf8_path(value, label)
    path = value.to_s.dup
    path.force_encoding(Encoding::UTF_8) if path.encoding == Encoding::ASCII_8BIT
    path = path.encode(Encoding::UTF_8) unless path.encoding == Encoding::UTF_8
    unless path.valid_encoding?
      raise Encoding::InvalidByteSequenceError, "#{label} is not valid UTF-8"
    end
    path
  end
end

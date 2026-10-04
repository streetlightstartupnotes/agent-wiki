# frozen_string_literal: true

# SidebarOrder persists the user's manual document order per page type. It is
# project-local so the same ordering survives reloads, sessions, and machines.
module SidebarOrder
  extend self

  FILE = ".llm-wiki/sidebar-order.json"
  LOCK = ".llm-wiki/sidebar-order.lock"
  ROOT_PARENT = "__root__"

  def load(project_path)
    path = File.join(project_path, FILE)
    parsed = File.file?(path) ? (JSON.parse(File.read(path, encoding: "utf-8")) rescue {}) : {}
    types = parsed["types"].is_a?(Hash) ? parsed["types"] : {}
    clean_types = types.each_with_object({}) do |(type, paths), clean|
        key = WikiEngine.canonical_page_type_id(project_path, type)
        next if key.empty? || !paths.is_a?(Array)
        clean[key] ||= []
        clean[key].concat(paths.map(&:to_s).select { |item| wiki_page_path?(item) })
        clean[key].uniq!
      end
    parents = parsed["parents"].is_a?(Hash) ? parsed["parents"] : {}
    clean_parents = parents.each_with_object({}) do |(type, buckets), clean|
      key = WikiEngine.canonical_page_type_id(project_path, type)
      next if key.empty? || !buckets.is_a?(Hash)
      clean[key] ||= {}
      buckets.each do |parent, paths|
        parent_key = parent.to_s == ROOT_PARENT ? ROOT_PARENT : parent.to_s
        next unless parent_key == ROOT_PARENT || wiki_page_path?(parent_key)
        next unless paths.is_a?(Array)
        clean[key][parent_key] ||= []
        clean[key][parent_key].concat(paths.map(&:to_s).select { |item| wiki_page_path?(item) })
        clean[key][parent_key].uniq!
      end
      clean[key].delete_if { |_, paths| paths.empty? }
    end
    {
      "types" => clean_types,
      "parents" => clean_parents
    }
  end

  def reorder(project_path, path:, target_type:, target_index:)
    page_path = path.to_s
    raw_target_type = target_type.to_s.strip
    new_type = WikiEngine.canonical_page_type_id(project_path, raw_target_type)
    raise ArgumentError, "Invalid page path" unless wiki_page_path?(page_path)
    raise ArgumentError, "Invalid page type" if raw_target_type.empty? || raw_target_type.match?(/[\\\/\r\n]/)

    full = File.join(project_path, page_path)
    raise ArgumentError, "File not found" unless File.file?(full)

    result = nil
    Storage.with_lock(File.join(project_path, LOCK)) do
      content = File.read(full, encoding: "utf-8")
      frontmatter = WikiEngine.parse_frontmatter(content)
      relative = page_path.sub(%r{\Awiki/}, "")
      old_type = WikiEngine.canonical_page_type(project_path, frontmatter["type"], relative)
      config = load(project_path)
      rows = page_rows(project_path)

      old_paths = ordered_paths(rows, config, old_type).reject { |item| item == page_path }
      target_paths = if old_type == new_type
        old_paths
      else
        ordered_paths(rows, config, new_type).reject { |item| item == page_path }
      end
      index = [[target_index.to_i, 0].max, target_paths.length].min
      target_paths.insert(index, page_path)

      config["types"].each_value { |paths| paths.delete(page_path) }
      config["types"][old_type] = old_paths unless old_type == new_type
      config["types"][new_type] = target_paths
      config["types"].delete_if { |_, paths| paths.empty? }

      updated = old_type == new_type ? content : WikiEngine.update_page_metadata(content, type: new_type)
      Storage.atomic_write(full, updated, encoding: "utf-8") if updated != content
      Storage.atomic_write(File.join(project_path, FILE), JSON.pretty_generate(config), encoding: "utf-8")

      result = {
        "ok" => true,
        "path" => page_path,
        "old_type" => old_type,
        "type" => new_type,
        "target_index" => index,
        "before" => index.positive? ? target_paths[index - 1] : nil,
        "after" => target_paths[index + 1],
        "order" => config,
        "revision" => Storage.revision(full)
      }
    end
    result
  end

  # Move a page tree to another parent and/or sibling position. Filesystem
  # paths encode hierarchy, while `parents` stores an independent order for
  # every sibling list. Both are committed under the sidebar lock.
  def move_tree(project_path, path:, target_type:, target_parent:, target_index: nil, target_path: nil, position: nil)
    page_path = path.to_s
    raw_target_type = target_type.to_s.strip
    new_type = WikiEngine.canonical_page_type_id(project_path, raw_target_type)
    parent_path = target_parent.to_s.strip
    parent_path = nil if parent_path.empty?
    raise ArgumentError, "Invalid page path" unless wiki_page_path?(page_path)
    raise ArgumentError, "Invalid page type" if raw_target_type.empty? || raw_target_type.match?(/[\\\/\r\n]/)
    raise ArgumentError, "Invalid parent path" if parent_path && !wiki_page_path?(parent_path)

    result = nil
    Storage.with_lock(File.join(project_path, LOCK)) do
      rows = page_rows(project_path)
      source_row = rows.find { |row| row[:path] == page_path }
      raise ArgumentError, "File not found" unless source_row
      source_type = source_row[:type]
      descendants = WikiEngine.sidebar_descendant_pages(project_path, page_path).map do |file|
        "wiki/#{file.sub("#{File.join(project_path, 'wiki')}/", "")}"
      end
      moved_paths = [page_path, *descendants].uniq
      raise ArgumentError, "A page cannot be moved inside itself" if parent_path && moved_paths.include?(parent_path)

      if parent_path
        parent_row = rows.find { |row| row[:path] == parent_path }
        raise ArgumentError, "Parent page not found" unless parent_row
        raise ArgumentError, "Parent and child must use the same category" unless parent_row[:type] == new_type
      end

      config = load(project_path)
      old_parent = parent_page_path(rows, page_path)
      target_siblings = ordered_sibling_paths(rows, config, new_type, parent_path)
        .reject { |candidate| moved_paths.include?(candidate) }
      drop_path = target_path.to_s.strip
      if !drop_path.empty?
        sibling_index = target_siblings.index(drop_path)
        raise ArgumentError, "Drop target is not in the selected parent" unless sibling_index
        index = sibling_index + (position.to_s == "after" ? 1 : 0)
      else
        requested_index = target_index.nil? ? target_siblings.length : target_index.to_i
        index = [[requested_index, 0].max, target_siblings.length].min
      end
      destination = if source_type == new_type && old_parent == parent_path
        page_path
      else
        destination_path(project_path, source_row, new_type, parent_path)
      end

      old_child_root = "wiki/#{WikiEngine.sidebar_child_directory(page_path)}"
      new_child_root = "wiki/#{WikiEngine.sidebar_child_directory(destination)}"
      preview_mapping = moved_paths.each_with_object({}) do |candidate, mapping|
        mapping[candidate] = if candidate == page_path
          destination
        else
          candidate.sub(old_child_root, new_child_root)
        end
      end
      preview_destinations = preview_mapping.values
      preview_destinations.each do |candidate|
        depth = WikiEngine.sidebar_content_depth(
          candidate,
          new_type,
          project_path: project_path,
          excluding_paths: moved_paths,
          additional_paths: preview_destinations
        )
        raise ArgumentError, "Pages can only be moved within three page levels" if depth > WikiEngine::MAX_SIDEBAR_CONTENT_LEVEL
      end

      child_orders = moved_paths.each_with_object({}) do |moved_parent, orders|
        children = ordered_sibling_paths(rows, config, source_type, moved_parent)
          .select { |candidate| moved_paths.include?(candidate) }
        orders[moved_parent] = children unless children.empty?
      end

      move_result = if destination == page_path && source_type == new_type
        { "ok" => true, "from" => page_path, "to" => page_path, "moved_paths" => preview_mapping, "updated_links" => 0, "cleaned_files" => [] }
      else
        CascadeDelete.move_page_tree(project_path, page_path, destination, target_type: new_type)
      end
      mapping = move_result["moved_paths"] || preview_mapping
      moved_destination_paths = mapping.values.to_set
      remap_config_paths!(config, mapping)

      config["parents"].each_value do |buckets|
        buckets.each_value { |paths| paths.delete(mapping.fetch(page_path, destination)) }
      end
      config["parents"][new_type] ||= {}
      child_orders.each do |old_key, paths|
        new_key = mapping.fetch(old_key, old_key)
        config["parents"][new_type] ||= {}
        config["parents"][new_type][new_key] = paths.map { |candidate| mapping.fetch(candidate, candidate) }
      end

      config["parents"].each do |type, buckets|
        buckets.keys.each do |key|
          next unless moved_destination_paths.include?(key) && type != new_type
          config["parents"][new_type] ||= {}
          config["parents"][new_type][key] ||= buckets[key]
          buckets.delete(key)
        end
      end

      moved_root = mapping.fetch(page_path, destination)
      ordered_target_siblings = target_siblings.map { |candidate| mapping.fetch(candidate, candidate) }
      ordered_target_siblings.insert(index, moved_root)
      target_parent_key = parent_path ? mapping.fetch(parent_path, parent_path) : ROOT_PARENT
      config["parents"][new_type] ||= {}
      config["parents"][new_type][target_parent_key] = ordered_target_siblings

      config["types"].each_value do |paths|
        paths.delete_if { |candidate| moved_paths.include?(candidate) || moved_destination_paths.include?(candidate) }
      end
      config["types"][new_type] ||= []
      config["types"][new_type].concat(mapping.values)
      config["types"].each_value(&:uniq!)
      config["types"].delete_if { |_, paths| paths.empty? }
      config["parents"].each_value { |buckets| buckets.delete_if { |_, paths| paths.empty? } }
      config["parents"].delete_if { |_, buckets| buckets.empty? }
      Storage.atomic_write(File.join(project_path, FILE), JSON.pretty_generate(config), encoding: "utf-8")

      result = move_result.merge(
        "old_type" => source_type,
        "type" => new_type,
        "old_parent" => old_parent,
        "parent" => parent_path,
        "path" => moved_root,
        "target_index" => index,
        "order" => config,
        "revision" => Storage.revision(File.join(project_path, moved_root))
      )
    end
    result
  end

  def delete_type(project_path, type)
    canonical = WikiEngine.canonical_page_type_id(project_path, type)
    Storage.with_lock(File.join(project_path, LOCK)) do
      config = load(project_path)
      config["types"].delete(canonical)
      config["parents"].delete(canonical)
      Storage.atomic_write(File.join(project_path, FILE), JSON.pretty_generate(config), encoding: "utf-8")
      config
    end
  end

  private

  def parent_page_path(rows, path)
    parent_directory = WikiEngine.sidebar_parent_directory(path)
    return nil if parent_directory.empty? || parent_directory == "wiki"
    candidates = ["#{parent_directory}.md", "#{parent_directory}/index.md"]
    parent = rows.find { |row| candidates.include?(row[:path]) }
    return nil unless parent
    parent_depth = WikiEngine.sidebar_content_depth(parent[:path], parent[:type])
    child_depth = WikiEngine.sidebar_content_depth(path, parent[:type])
    child_depth == parent_depth + 1 ? parent[:path] : nil
  end

  def ordered_sibling_paths(rows, config, type, parent)
    actual_rows = rows.select do |row|
      row[:type] == type && parent_page_path(rows, row[:path]) == parent
    end
    actual = actual_rows.sort_by { |row| [row[:title].downcase, row[:path].downcase] }.map { |row| row[:path] }
    bucket = parent || ROOT_PARENT
    stored = Array(config.dig("parents", type, bucket)).select { |candidate| actual.include?(candidate) }
    legacy = Array(config.dig("types", type)).select { |candidate| actual.include?(candidate) }
    stored + (legacy - stored) + (actual - stored - legacy)
  end

  def destination_path(project_path, source_row, target_type, target_parent)
    source_path = source_row[:path]
    index_page = File.basename(source_path).casecmp("index.md").zero?
    source_depth = WikiEngine.sidebar_content_depth(source_path, source_row[:type], project_path: project_path)
    slug = if index_page
      source_depth == 1 ? WikiEngine.slugify(source_row[:title]) : File.basename(File.dirname(source_path))
    else
      File.basename(source_path, ".md")
    end
    base = if target_parent
      "wiki/#{WikiEngine.sidebar_child_directory(target_parent)}"
    else
      storage_root = WikiEngine.sidebar_storage_root(project_path, target_type)
      "wiki/#{storage_root || target_type}"
    end
    index_page ? "#{base}/#{slug}/index.md" : "#{base}/#{slug}.md"
  end

  def remap_config_paths!(config, mapping)
    config["types"].each_value do |paths|
      paths.map! { |path| mapping.fetch(path, path) }
      paths.uniq!
    end
    config["parents"] = config["parents"].each_with_object({}) do |(type, buckets), clean|
      clean[type] ||= {}
      buckets.each do |parent, paths|
        mapped_parent = parent == ROOT_PARENT ? ROOT_PARENT : mapping.fetch(parent, parent)
        clean[type][mapped_parent] ||= []
        clean[type][mapped_parent].concat(paths.map { |path| mapping.fetch(path, path) })
        clean[type][mapped_parent].uniq!
      end
    end
  end

  def wiki_page_path?(path)
    value = path.to_s.tr("\\", "/")
    value.start_with?("wiki/") && value.downcase.end_with?(".md") && !value.split("/").include?("..")
  end

  def page_rows(project_path)
    wiki_dir = File.join(project_path, "wiki")
    Dir.glob(File.join(wiki_dir, "**", "*.md")).map do |file|
      relative = file.sub("#{wiki_dir}/", "")
      next if %w[index.md overview.md log.md].include?(relative.downcase)
      content = File.read(file, encoding: "utf-8") rescue next
      frontmatter = WikiEngine.parse_frontmatter(content)
      {
        path: "wiki/#{relative}",
        type: WikiEngine.canonical_page_type(project_path, frontmatter["type"], relative),
        title: WikiEngine.extract_title(content, file).to_s
      }
    end.compact
  end

  def ordered_paths(rows, config, type)
    actual = rows.select { |row| row[:type] == type }
      .sort_by { |row| [row[:title].downcase, row[:path].downcase] }
      .map { |row| row[:path] }
    stored = Array(config.dig("types", type)).select { |path| actual.include?(path) }
    stored + (actual - stored)
  end
end

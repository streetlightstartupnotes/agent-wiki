# frozen_string_literal: true

# Durable ownership of the knowledge base attached to each OpenClacky
# conversation. OpenClacky's working_dir remains the runtime directory, while
# this registry lets the extension recover when that mutable field or browser
# tab state no longer points at the original wiki.
module SessionProjectBinding
  extend self

  FILE_NAME = "session-projects.json"

  def get(data_dir, session_id)
    id = normalize_session_id(session_id)
    return nil unless id

    entry = bindings(data_dir).dig("bindings", id)
    value = entry.is_a?(Hash) ? entry["path"] : entry
    value.to_s.strip.empty? ? nil : File.expand_path(value.to_s)
  end

  def set(data_dir, session_id, project_path)
    id = normalize_session_id(session_id)
    return nil unless id

    expanded = File.expand_path(project_path.to_s)
    Storage.update_json(registry_path(data_dir), empty_registry) do |data|
      data = empty_registry unless data.is_a?(Hash)
      data["version"] = 1
      data["bindings"] = {} unless data["bindings"].is_a?(Hash)
      data["bindings"][id] = { "path" => expanded, "updated_at" => Time.now.iso8601 }
      data
    end
    expanded
  end

  def delete(data_dir, session_id)
    id = normalize_session_id(session_id)
    return false unless id

    removed = false
    Storage.update_json(registry_path(data_dir), empty_registry) do |data|
      data["bindings"] = {} unless data.is_a?(Hash) && data["bindings"].is_a?(Hash)
      removed = !data["bindings"].delete(id).nil?
      data
    end
    removed
  end

  def delete_project(data_dir, project_path)
    expanded = File.expand_path(project_path.to_s)
    removed = 0
    Storage.update_json(registry_path(data_dir), empty_registry) do |data|
      data["bindings"] = {} unless data.is_a?(Hash) && data["bindings"].is_a?(Hash)
      data["bindings"].delete_if do |_id, entry|
        value = entry.is_a?(Hash) ? entry["path"] : entry
        match = !value.to_s.empty? && File.expand_path(value.to_s) == expanded
        removed += 1 if match
        match
      end
      data
    end
    removed
  end

  def session_ids_for_project(data_dir, project_path)
    expanded = File.expand_path(project_path.to_s)
    entries = bindings(data_dir)["bindings"]
    return [] unless entries.is_a?(Hash)
    entries.each_with_object([]) do |(session_id, entry), result|
      value = entry.is_a?(Hash) ? entry["path"] : entry
      result << session_id if !value.to_s.empty? && File.expand_path(value.to_s) == expanded
    end
  end

  def project_paths(data_dir)
    entries = bindings(data_dir)["bindings"]
    return [] unless entries.is_a?(Hash)

    entries.each_value.each_with_object([]) do |entry, result|
      value = entry.is_a?(Hash) ? entry["path"] : entry
      result << File.expand_path(value.to_s) unless value.to_s.strip.empty?
    end.uniq
  end

  private

  def registry_path(data_dir)
    File.join(data_dir, FILE_NAME)
  end

  def bindings(data_dir)
    path = registry_path(data_dir)
    return empty_registry unless File.file?(path)
    parsed = JSON.parse(File.read(path, encoding: "utf-8"))
    parsed.is_a?(Hash) ? parsed : empty_registry
  rescue JSON::ParserError, SystemCallError
    empty_registry
  end

  def empty_registry
    { "version" => 1, "bindings" => {} }
  end

  def normalize_session_id(session_id)
    value = session_id.to_s.strip
    value.empty? ? nil : value
  end
end

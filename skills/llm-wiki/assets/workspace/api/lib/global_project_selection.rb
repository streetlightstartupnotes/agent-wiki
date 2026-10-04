# frozen_string_literal: true

# One user-selected knowledge base can be used as the default by every
# OpenClacky conversation. A conversation-specific binding still wins, so a
# dedicated Wiki Assistant or an onboarding session remains isolated.
module GlobalProjectSelection
  extend self

  FILE_NAME = "global-project.json"

  def status(data_dir)
    path = registry_path(data_dir)
    return { "path" => nil, "enabled" => false } unless File.file?(path)
    data = JSON.parse(File.read(path, encoding: "utf-8"))
    value = data.is_a?(Hash) ? data["path"] : nil
    {
      "path" => value.to_s.strip.empty? ? nil : File.expand_path(value.to_s),
      # Existing 0.0.23 selection files predate the pause switch and are on by
      # default, preserving the user's current behavior after an update.
      "enabled" => data.is_a?(Hash) && data["enabled"] != false
    }
  rescue JSON::ParserError, SystemCallError
    { "path" => nil, "enabled" => false }
  end

  def get(data_dir)
    status(data_dir)["path"]
  end

  def enabled?(data_dir)
    state = status(data_dir)
    !state["path"].nil? && state["enabled"] == true
  end

  def set(data_dir, project_path, enabled: true)
    expanded = File.expand_path(project_path.to_s)
    Storage.atomic_write(
      registry_path(data_dir),
      JSON.pretty_generate({ "version" => 1, "path" => expanded, "enabled" => enabled == true, "updated_at" => Time.now.iso8601 }),
      encoding: "utf-8"
    )
    expanded
  end

  def set_enabled(data_dir, enabled)
    selected = get(data_dir)
    return nil unless selected
    set(data_dir, selected, enabled: enabled == true)
  end

  def clear(data_dir)
    path = registry_path(data_dir)
    return false unless File.file?(path)
    File.delete(path)
    true
  rescue SystemCallError
    false
  end

  def clear_project(data_dir, project_path)
    selected = get(data_dir)
    return false unless selected && selected == File.expand_path(project_path.to_s)
    clear(data_dir)
  end

  private

  def registry_path(data_dir)
    File.join(data_dir, FILE_NAME)
  end
end

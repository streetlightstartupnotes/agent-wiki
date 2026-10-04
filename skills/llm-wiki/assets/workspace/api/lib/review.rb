# frozen_string_literal: true

# Review — Audit/review queue management
#
# Stores review items generated during ingest (follow-up research suggestions,
# verification needs, expansion opportunities).
# Items can be: resolved (accept/dismiss) or promoted to deep research.

module Review
  extend self

  REVIEW_FILE = ".llm-wiki/review-queue.json"

  # List all review items (pending + resolved)
  def list(project_path, status: nil)
    items = load_items(project_path)
    items = items.select { |i| i["status"] == status } if status
    items.sort_by { |i| i["created_at"] || "" }.reverse
  end

  # Add items (from ingest pipeline)
  def add_items(project_path, items)
    path = File.join(project_path, REVIEW_FILE)
    Storage.update_json(path, []) do |existing|
      existing.concat(items)
      existing
    end
  end

  # Resolve a review item
  def resolve(project_path, item_id, action)
    return { "ok" => false, "error" => "Invalid action. Use: complete, dismiss, research" } unless %w[accept complete dismiss research].include?(action)
    selected = nil
    path = File.join(project_path, REVIEW_FILE)
    Storage.update_json(path, []) do |items|
      selected = items.find { |item| item["id"] == item_id }
      next items unless selected
      selected["status"] = case action
      when "accept", "complete" then "completed"
      when "dismiss" then "dismissed"
      else "researching"
      end
      selected["resolved_at"] = Time.now.iso8601
      items
    end
    return { "ok" => false, "error" => "Item not found" } unless selected
    { "ok" => true, "item" => selected }
  end

  # Get counts by status
  def counts(project_path)
    items = load_items(project_path)
    {
      "total" => items.size,
      "pending" => items.count { |i| i["status"] == "pending" },
      "completed" => items.count { |i| %w[completed accepted].include?(i["status"]) },
      "dismissed" => items.count { |i| i["status"] == "dismissed" },
      "researching" => items.count { |i| i["status"] == "researching" }
    }
  end

  private

  def load_items(project_path)
    path = File.join(project_path, REVIEW_FILE)
    return [] unless File.exist?(path)
    items = JSON.parse(File.read(path))
    raise ArgumentError, "Review history is invalid; the original file has been preserved" unless items.is_a?(Array) && items.all? { |item| item.is_a?(Hash) }
    items
  end

  def save_items(project_path, items)
    dir = File.join(project_path, ".llm-wiki")
    FileUtils.mkdir_p(dir)
    path = File.join(project_path, REVIEW_FILE)
    Storage.atomic_write(path, JSON.pretty_generate(items))
  end
end

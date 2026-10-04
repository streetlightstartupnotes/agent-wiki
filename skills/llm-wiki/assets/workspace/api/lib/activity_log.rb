# frozen_string_literal: true

# ActivityLog keeps an internal, human-readable record of completed mutations.
# The file deliberately lives under wiki/ for portability, but the WebUI hides
# it from the knowledge tree and graph/search/lint already exclude it.
module ActivityLog
  extend self

  FILE = "wiki/log.md"
  HEADER = "# Activity Log\n\n> Internal operation history. Hidden from the knowledge tree.\n\n"

  def record(project_path, action, detail = nil, actor: "system", at: Time.now)
    return nil if project_path.to_s.empty?

    path = File.join(project_path, FILE)
    lock_path = File.join(project_path, ".llm-wiki", "activity-log.lock")
    Storage.with_lock(lock_path) do
      current = File.file?(path) ? File.read(path, encoding: "utf-8") : HEADER
      current = HEADER if current.strip.empty?
      line = "- #{at.iso8601} | #{clean(actor, 40)} | #{clean(action, 80)}"
      cleaned_detail = clean(detail, 500)
      line += " | #{cleaned_detail}" unless cleaned_detail.empty?
      Storage.atomic_write(path, "#{current.rstrip}\n#{line}\n", encoding: "utf-8")
    end
    path
  end

  def hidden_page?(relative_path)
    relative_path.to_s.tr("\\", "/").downcase == "log.md"
  end

  private

  def clean(value, limit)
    value.to_s.encode("UTF-8", invalid: :replace, undef: :replace, replace: "�")
      .gsub(/[\r\n\t]+/, " ")
      .gsub(/\s+/, " ")
      .strip[0, limit]
  end
end

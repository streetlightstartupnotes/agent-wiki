# frozen_string_literal: true

# LLM Wiki — API Handler
# Mounts at /api/ext/llm-wiki/
#
# Architecture mirrors the original llm_wiki Tauri app:
# - Three-layer structure: raw/sources → wiki/ → schema.md/purpose.md
# - Two-step chain-of-thought ingest (analyze → generate)
# - Four-signal knowledge graph (direct link, source overlap, Adamic-Adar, type affinity)
# - Louvain community detection
# - CJK-aware search with graph expansion
# - Deep research orchestration
# - Review/audit queue
# - Recoverable leaf deletion through OpenClacky's native trash
# WebUI/API compatibility pass: 2026-07-31 legacy recovery and binary-safe snapshots

require "json"
require "time"
require "securerandom"
require "fileutils"
require "digest/sha2"
require "uri"
require "net/http"
require "yaml"
require "set"
require "open3"
require "find"
require "base64"

# ── Load helper modules (hot-reload friendly) ─────────────────────────────────
%w[storage activity_log session_project_binding global_project_selection wiki_engine wiki_import legacy_project_recovery ingest graph search lint research cascade_delete review sidebar_order].each do |mod|
  load File.join(__dir__, "lib", "#{mod}.rb")
end

class LlmWikiHandler < Clacky::ApiExtension
  WORKSPACE_VERSION = JSON.parse(File.read(File.join(__dir__, "../package.json"))).fetch("version").freeze
  WIKI_ASSET_TYPES = {
    ".png" => "image/png", ".jpg" => "image/jpeg", ".jpeg" => "image/jpeg",
    ".gif" => "image/gif", ".webp" => "image/webp",
    ".pdf" => "application/pdf", ".txt" => "text/plain; charset=utf-8",
    ".md" => "text/markdown; charset=utf-8", ".markdown" => "text/markdown; charset=utf-8",
    ".csv" => "text/csv; charset=utf-8", ".json" => "application/json; charset=utf-8",
    ".doc" => "application/msword", ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls" => "application/vnd.ms-excel", ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt" => "application/vnd.ms-powerpoint", ".pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".zip" => "application/zip", ".mp3" => "audio/mpeg", ".m4a" => "audio/mp4",
    ".wav" => "audio/wav", ".mp4" => "video/mp4", ".mov" => "video/quicktime"
  }.freeze
  WIKI_IMAGE_EXTENSIONS = %w[.png .jpg .jpeg .gif .webp].freeze
  MAX_WIKI_ASSET_BYTES = 25 * 1024 * 1024

  # ═══════════════════════════════════════════════════════════════════════════
  # PROJECT MANAGEMENT
  # ═══════════════════════════════════════════════════════════════════════════

  # GET /status — extension health + current project info
  get "/status" do
    path = current_project_path
    selected_global_path = selected_global_project_path
    json(
      ok: true,
      version: WORKSPACE_VERSION,
      session_id: request_session_id,
      project: path,
      project_info: path ? project_info_for(path) : nil,
      project_scope: project_scope,
      global_project: selected_global_path ? project_info_for(selected_global_path) : nil,
      global_enabled: GlobalProjectSelection.enabled?(ext_data_dir),
      projects: list_projects
    )
  end

  # GET /projects — list all wiki projects
  get "/projects" do
    json(projects: list_projects)
  end

  # GET /global-project — the default wiki available to every conversation.
  get "/global-project" do
    path = selected_global_project_path
    enabled = GlobalProjectSelection.enabled?(ext_data_dir)
    json(selected: !path.nil?, active: !path.nil? && enabled, enabled: enabled, project: path ? project_info_for(path) : nil)
  end

  # POST /global-project — explicitly select or clear the global default.
  post "/global-project" do
    error!("Untrusted request origin", status: 403) unless trusted_local_origin?
    body = json_body
    if body["clear"] == true
      previous = selected_global_project_path
      GlobalProjectSelection.clear(ext_data_dir)
      best_effort_after_commit("record global project clear") do
        ActivityLog.record(previous, "global_project_cleared", session_log_detail, actor: "system") if previous
      end
      json(ok: true, selected: false, active: false, enabled: false, project: nil)
    end

    if body.key?("enabled") && body["path"].to_s.strip.empty?
      path = selected_global_project_path
      error!("No global knowledge base is selected", status: 400) unless path
      enabled = body["enabled"] == true
      GlobalProjectSelection.set_enabled(ext_data_dir, enabled)
      action = enabled ? "global_access_resumed" : "global_access_paused"
      best_effort_after_commit("record global access change") do
        ActivityLog.record(path, action, session_log_detail, actor: "user")
      end
      json(ok: true, selected: true, active: enabled, enabled: enabled, project: project_info_for(path))
    end

    error!("Project path is required", status: 400) if body["path"].to_s.strip.empty?
    path = File.expand_path(body["path"].to_s)
    error!("Project not found", status: 404) unless Dir.exist?(path)
    error!("Not an LLM Wiki project", status: 400) unless compatible_project?(path)
    with_project_bootstrap_rollback(path) do
      migrate_compatible_legacy_project(path)
      complete_contentful_project_metadata(path)
      select_global_project(path, actor: "user")
    end
    json(ok: true, selected: true, active: true, enabled: true, project: project_info_for(path))
  end

  # GET /projects/inspect?path=/... — validate an existing project before a
  # browser creates a session for it. This does not select or mutate anything.
  get "/projects/inspect" do
    raw_path = utf8_param(query["path"]).to_s.strip
    error!("Project path is required", status: 400) if raw_path.empty?
    requested_path = File.expand_path(raw_path)
    native_project = wiki_project?(requested_path)
    explicit_legacy = !native_project &&
      (compatible_project?(requested_path) || portable_legacy_project?(requested_path))
    inspection = if explicit_legacy
      legacy_project_inspection(requested_path)
    else
      WikiImport.inspect_folder(requested_path)
    end
    json(inspection: inspection, project: inspection["project"])
  rescue ArgumentError => error
    status = error.message == "Project not found" ? 404 : 400
    error!(error.message, status: status)
  end

  # POST /projects — create a new wiki project
  post "/projects" do
    body = json_body
    name = body["name"].to_s.strip
    template = body["template"].to_s.strip
    language = body["language"].to_s.strip
    error!("Project name is required", status: 400) if name.empty?
    destination = File.join(projects_root, WikiEngine.slugify(name))
    error!("A project with this name already exists", status: 409) if Dir.exist?(destination)
    project = WikiEngine.create_project(projects_root, name, template: template, language: language)
    bind_session_to_project(project["path"]) unless request_session_id.empty?
    json(project: project, global_selected: selected_global_project_path == project["path"])
  end

  # POST /projects/provision — create an empty project for conversational
  # onboarding. The newly-created Wiki Assistant session uses this directory
  # as its working_dir and the onboarding skill fills in the human metadata.
  post "/projects/provision" do
    body = json_body
    language = body["language"].to_s.downcase.start_with?("en") ? "English" : "Chinese"
    json(project: provision_project(language), status: "provisional")
  end

  # POST /projects/start-onboarding — create the project and start its Wiki
  # Assistant session as one server-side operation. Keeping this orchestration
  # out of the browser avoids host/session timing differences across macOS,
  # Linux, and WSL installations.
  post "/projects/start-onboarding", timeout: 120 do
    body = json_body
    language = body["language"].to_s.downcase.start_with?("en") ? "English" : "Chinese"
    request_id = body["request_id"].to_s.strip
    request_id = SecureRandom.uuid if request_id.empty?
    error!("Invalid onboarding request", status: 400) unless request_id.match?(/\A[a-zA-Z0-9._:-]{8,128}\z/)

    # One lock covers the whole transaction. Together with the durable request
    # receipt this makes a double-click or a retry after a lost HTTP response
    # return the first result instead of creating another project/session.
    Storage.with_lock(onboarding_lock_path) do
      receipt = onboarding_request_entry(request_id)
      if receipt.nil?
        resumable = latest_resumable_onboarding_entry
        if resumable
          save_onboarding_result(
            request_id,
            resumable["project_path"],
            resumable["session_id"],
            resumable["reused_session"] == true,
            stage: resumable["stage"],
            error: resumable["error"]
          )
          receipt = onboarding_request_entry(request_id)
        end
      end
      if receipt && receipt["stage"] == "assistant_started"
        cached = cached_onboarding_result(request_id)
        json(cached.merge(request_id: request_id, duplicate: true)) if cached
      end

      session_name = language == "English" ? "New Wiki" : "新知识库"
      display_message = language == "English" ? "Start creating my knowledge base" : "开始创建我的知识库"
      # Reject a busy current Wiki Assistant before provisioning anything. A
      # retry with a durable receipt skips this preflight and resumes its own
      # recorded project/session instead.
      initial_reusable_session_id = receipt ? nil : reusable_wiki_session_id
      project = if receipt && wiki_project?(receipt["project_path"])
        WikiEngine.project_info(receipt["project_path"])
      else
        created = provision_project(language)
        save_onboarding_result(request_id, created["path"], nil, false, stage: "project_created")
        created
      end

      recorded_session_id = receipt && receipt["session_id"].to_s
      recorded_session_id = nil if recorded_session_id.to_s.empty? || !registry&.ensure(recorded_session_id)
      reusable_session_id = recorded_session_id || initial_reusable_session_id
      reused_session = receipt ? receipt["reused_session"] == true : !reusable_session_id.nil?
      previous_working_dir = nil
      created_session_id = nil
      session_id = reusable_session_id

      begin
        if session_id
          current_session = registry.get(session_id)
          previous_working_dir = current_session[:agent]&.working_dir unless recorded_session_id
          attach_session_to_project(session_id, project["path"])
        else
          session_id = create_session(
            name: session_name,
            working_dir: project["path"],
            profile: "wiki-assistant",
            source: :ext
          )
          created_session_id = session_id
          SessionProjectBinding.set(ext_data_dir, session_id, project["path"])
          touch_project_access(project["path"])
        end
        verify_session_project_attachment!(session_id, project["path"])
        save_onboarding_result(request_id, project["path"], session_id, reused_session, stage: "session_ready")
      rescue Clacky::ApiExtension::Halt => halt
        restore_session_working_dir(session_id, previous_working_dir) if reused_session && !recorded_session_id
        discard_created_session(created_session_id) if created_session_id
        save_onboarding_result(request_id, project["path"], nil, false, stage: "session_failed", error: halt_payload_message(halt))
        onboarding_failure!(
          "Knowledge base was created, but the Wiki Assistant session could not be created",
          stage: "session_create_failed", request_id: request_id, project: project,
          cause: halt_payload_message(halt)
        )
      rescue StandardError => error
        Clacky::Logger.error("[llm-wiki] failed to create onboarding session: #{error.class}: #{error.message}")
        restore_session_working_dir(session_id, previous_working_dir) if reused_session && !recorded_session_id
        discard_created_session(created_session_id) if created_session_id
        save_onboarding_result(request_id, project["path"], nil, false, stage: "session_failed", error: error.message)
        onboarding_failure!(
          "Knowledge base was created, but the Wiki Assistant session could not be created",
          stage: "session_create_failed", request_id: request_id, project: project,
          cause: error.message
        )
      end

      session = registry&.session_summary(session_id) || { id: session_id, name: session_name, working_dir: project["path"] }
      session_status = registry&.get(session_id)&.dig(:status)
      if session_status == :running
        save_onboarding_result(request_id, project["path"], session_id, reused_session, stage: "assistant_started")
      else
        begin
          submit_task(session_id, "/llm-wiki-onboard", display_message: display_message)
          save_onboarding_result(request_id, project["path"], session_id, reused_session, stage: "assistant_started")
        rescue Clacky::ApiExtension::Halt => halt
          save_onboarding_result(request_id, project["path"], session_id, reused_session, stage: "assistant_start_failed", error: halt_payload_message(halt))
          onboarding_failure!(
            "Knowledge base and conversation were created, but the Wiki Assistant could not be started",
            stage: "assistant_start_failed", request_id: request_id, project: project,
            session: session, cause: halt_payload_message(halt)
          )
        rescue StandardError => error
          Clacky::Logger.error("[llm-wiki] failed to submit onboarding task: #{error.class}: #{error.message}")
          save_onboarding_result(request_id, project["path"], session_id, reused_session, stage: "assistant_start_failed", error: error.message)
          onboarding_failure!(
            "Knowledge base and conversation were created, but the Wiki Assistant could not be started",
            stage: "assistant_start_failed", request_id: request_id, project: project,
            session: session, cause: error.message
          )
        end
      end

      json(
        project: WikiEngine.project_info(project["path"]),
        session: session,
        status: "onboarding",
        global_selected: false,
        reused_session: reused_session,
        request_id: request_id
      )
    end
  end

  # POST /projects/bootstrap — initialize the current Wiki Assistant working
  # directory when a user begins through conversation rather than the WebUI.
  # The explicit local project header is the same deterministic contract used
  # by the skills for lint/search and makes the operation idempotent.
  post "/projects/bootstrap" do
    body = json_body
    error!("Untrusted request origin", status: 403) unless trusted_local_origin?
    path = request_project_path
    path = utf8_param(body["path"]).strip if path.empty?
    error!("Working directory is required", status: 400) if path.empty?
    path = File.expand_path(path)
    error!("Working directory does not exist", status: 404) unless Dir.exist?(path)
    error!("Working directory is not writable", status: 403) unless File.writable?(path)

    language = body["language"].to_s.downcase.start_with?("en") ? "English" : "Chinese"
    default_name = language == "English" ? "New Wiki" : "新知识库"
    name = body["name"].to_s.strip
    name = default_name if name.empty?
    template = body["template"].to_s.strip
    template = "general" if template.empty?
    preflight_project_session_binding!(allow_running: true) unless request_session_id.empty?
    project = nil
    with_project_bootstrap_rollback(path) do
      project = if wiki_project?(path)
        WikiEngine.project_info(path)
      else
        WikiEngine.initialize_project(path, name, template: template, language: language, provisional: true)
      end
      bind_session_to_project(path) unless request_session_id.empty?
    end
    json(project: project, status: project["provisional"] ? "provisional" : "ready", global_selected: selected_global_project_path == project["path"])
  end

  # POST /projects/complete-onboarding — the server owns the critical state
  # transition. Agents provide the user-confirmed metadata after writing and
  # linting purpose/schema; they never edit the readiness flag directly.
  post "/projects/complete-onboarding" do
    error!("Untrusted request origin", status: 403) unless trusted_local_origin?
    body = json_body
    explicit_path = request_project_path
    explicit_path = utf8_param(body["path"]).strip if explicit_path.empty?
    path = explicit_path.empty? ? current_project_path : File.expand_path(explicit_path)
    error!("Knowledge base path is required", status: 400) if path.to_s.empty?
    error!("Not an LLM Wiki project", status: 400) unless wiki_project?(path)
    error!("Purpose is missing", status: 400) if File.read(File.join(path, "purpose.md"), encoding: "utf-8").strip.empty?
    error!("Schema is missing", status: 400) if File.read(File.join(path, "schema.md"), encoding: "utf-8").strip.empty?

    meta_path = File.join(path, ".llm-wiki", "project-meta.json")
    existing = File.file?(meta_path) ? (JSON.parse(File.read(meta_path, encoding: "utf-8")) rescue {}) : {}
    name = body["name"].to_s.strip
    language = body["language"].to_s.strip
    template = body["template"].to_s.strip
    completed = existing.merge(
      "name" => name.empty? ? (existing["name"] || File.basename(path)) : name,
      "language" => language.empty? ? existing["language"].to_s : language,
      "template" => template.empty? ? (existing["template"] || "general") : template,
      "provisional" => false,
      "format_version" => 2,
      "onboarding_completed_at" => Time.now.iso8601,
      "created_at" => existing["created_at"] || Time.now.iso8601
    )
    Storage.atomic_write(meta_path, JSON.pretty_generate(completed), encoding: "utf-8")
    best_effort_after_commit("record onboarding completion") do
      ActivityLog.record(path, "onboarding_completed", append_session_detail("Purpose and page taxonomy confirmed"), actor: "agent")
    end
    json(project: WikiEngine.project_info(path), status: "ready", global_selected: selected_global_project_path == File.expand_path(path))
  end

  # POST /projects/open — set current active project
  post "/projects/open" do
    body = json_body
    path = body["path"].to_s.strip
    error!("Project path is required", status: 400) if path.empty?
    error!("Project not found", status: 404) unless Dir.exist?(path)
    error!("Not an LLM Wiki project", status: 400) unless compatible_project?(path)
    preflight_project_session_binding!
    with_project_bootstrap_rollback(path) do
      migrate_compatible_legacy_project(path)
      complete_contentful_project_metadata(path)
      bind_session_to_project(path)
    end
    best_effort_after_commit("record project open") do
      ActivityLog.record(path, "project_opened", session_log_detail, actor: "user")
    end
    json(
      ok: true,
      project: WikiEngine.project_info(path),
      global_selected: selected_global_project_path == File.expand_path(path),
      global_enabled: GlobalProjectSelection.enabled?(ext_data_dir)
    )
  end

  # POST /projects/open-existing — recognize and load an existing wiki folder,
  # then connect it to a Wiki Assistant in the same server-side transaction.
  # Native LLM Wiki folders open in place. Other Markdown-based wikis are
  # copied into managed storage first so their original files stay untouched.
  post "/projects/open-existing", timeout: 600 do
    body = json_body
    raw_source_path = body["path"].to_s.strip
    error!("Project path is required", status: 400) if raw_source_path.empty?
    source_path = File.expand_path(raw_source_path)
    native_project = wiki_project?(source_path)
    explicitly_selected_legacy = !native_project && portable_legacy_project?(source_path)
    loaded = if !native_project && (compatible_project?(source_path) || explicitly_selected_legacy)
      project = project_info_for(source_path)
      {
        "project" => project,
        "inspection" => legacy_project_inspection(source_path),
        "imported" => false,
        "created" => false,
        "already_loaded" => true,
        "explicitly_selected_legacy" => explicitly_selected_legacy
      }
    else
      WikiImport.load_folder(source_path, projects_root)
    end
    project = loaded["project"]
    session = nil
    reused_session = false

    begin
      open_project = proc do
        unless wiki_project?(project["path"])
          project = migrate_compatible_legacy_project(
            project["path"],
            allow_explicit_portable: loaded["explicitly_selected_legacy"] == true
          )
        end
        project = complete_contentful_project_metadata(project["path"])
        session, reused_session = connect_wiki_session(project["path"], project["name"])
      end
      if loaded["created"]
        open_project.call
      else
        with_project_bootstrap_rollback(project["path"], &open_project)
      end
      best_effort_after_commit("remember opened project") do
        remember_project(project["path"]) unless managed_project_path?(project["path"])
      end
    rescue Clacky::ApiExtension::Halt
      FileUtils.rm_rf(project["path"]) if loaded["created"] && managed_project_path?(project["path"])
      raise
    rescue StandardError => error
      Clacky::Logger.error("[llm-wiki] failed to open existing wiki: #{error.class}: #{error.message}")
      FileUtils.rm_rf(project["path"]) if loaded["created"] && managed_project_path?(project["path"])
      error!("Existing wiki could not be loaded", status: 503)
    end

    action = loaded["imported"] ? "project_imported" : "project_opened"
    source = source_path
    detail = ["source=#{source}", session_log_detail].compact.reject(&:empty?).join(" ")
    best_effort_after_commit("record existing project open") do
      ActivityLog.record(project["path"], action, detail, actor: "user")
    end

    json(
      project: project_info_for(project["path"]),
      session: session,
      reused_session: reused_session,
      imported: loaded["imported"],
      already_loaded: loaded["already_loaded"] == true,
      global_selected: selected_global_project_path == project["path"],
      global_enabled: GlobalProjectSelection.enabled?(ext_data_dir),
      inspection: loaded["inspection"]
    )
  rescue ArgumentError => error
    status = error.message == "Project not found" ? 404 : 400
    error!(error.message, status: status)
  end

  # POST /projects/recover — restore a deleted legacy wiki from OpenClacky's
  # immutable task snapshots into a new managed directory. Merely listing
  # projects is read-only; restoration only happens after this explicit action.
  post "/projects/recover", timeout: 600 do
    error!("Untrusted request origin", status: 403) unless trusted_local_origin?
    recovery_id = json_body["recovery_id"].to_s.strip
    error!("Recovery id is required", status: 400) if recovery_id.empty?
    error!("Invalid recovery ID", status: 400) unless recovery_id.match?(/\Alegacy-[0-9a-f]{24}\z/)

    project = nil
    restored = false
    recovery_log_detail = nil
    LegacyProjectRecovery.recovery_lock(destination_root: projects_root) do
      candidate = legacy_recovery_candidates(recovered_ids: []).find { |item| item["recovery_id"] == recovery_id }
      project = recovered_project_for_id(recovery_id, candidate: candidate)
      unless project
        error!("Historical knowledge base is no longer recoverable", status: 404) unless candidate
        project = LegacyProjectRecovery.restore(candidate: candidate, destination_root: projects_root)
        LegacyProjectRecovery.validate_receipt!(
          project_path: project["path"],
          recovery_id: recovery_id,
          candidate: candidate
        )
        restored = true
        provenance = Array(candidate["source_session_ids"]).join(",")
        recovery_log_detail = "recovery_id=#{recovery_id} source_sessions=#{provenance}"
      end
    end

    best_effort_after_commit("record recovered project") do
      ActivityLog.record(project["path"], "project_recovered", recovery_log_detail, actor: "user")
    end if restored
    session, reused_session = connect_wiki_session(project["path"], project["name"])
    touch_project_access(project["path"])
    json(
      ok: true,
      restored: restored,
      project: project_info_for(project["path"]),
      session: session,
      reused_session: reused_session,
      global_selected: selected_global_project_path == project["path"],
      global_enabled: GlobalProjectSelection.enabled?(ext_data_dir)
    )
  rescue LegacyProjectRecovery::DestinationExists => error
    error!(error.message, status: 409)
  rescue LegacyProjectRecovery::RecoveryError => error
    error!(error.message, status: 400)
  end

  # DELETE /projects — remove a project managed by this extension
  delete "/projects" do
    body = json_body
    path = File.expand_path(body["path"].to_s)
    error!("Project path is required", status: 400) if body["path"].to_s.strip.empty?
    error!("Only managed projects can be deleted", status: 403) unless managed_project_path?(path)
    error!("Project not found", status: 404) unless Dir.exist?(path)
    error!("Not an LLM Wiki project", status: 400) unless wiki_project?(path)

    SessionProjectBinding.delete_project(ext_data_dir, path)
    GlobalProjectSelection.clear_project(ext_data_dir, path)
    FileUtils.rm_rf(path)
    forget_project(path)
    json(ok: true)
  end

  # POST /conversation/capture — start a non-interrupting task in the exact
  # source conversation. The session binding still wins over the selected
  # global wiki, and an explicitly paused global wiki remains available for
  # this manual action.
  post "/conversation/capture" do
    error!("Untrusted request origin", status: 403) unless trusted_local_origin?
    session_id = request_session_id
    error!("Session id is required", status: 400) if session_id.empty?
    require_project!

    path = current_project_path
    project = nil
    with_project_bootstrap_rollback(path) do
      project = migrate_compatible_legacy_project(path) unless wiki_project?(path)
      project = complete_contentful_project_metadata(path)
      error!("Finish onboarding before summarizing this conversation", status: 409) if project["provisional"] == true

      chinese = req["Accept-Language"].to_s.downcase.start_with?("zh")
      display_message = chinese ? "归纳当前对话进知识库" : "Summarize this conversation into the knowledge base"
      submit_task(
        session_id,
        "/llm-wiki-capture",
        display_message: display_message,
        interrupt: false
      )
    end
    json(
      ok: true,
      started: true,
      session_id: session_id,
      project: project,
      project_scope: project_scope
    )
  end

  # ═══════════════════════════════════════════════════════════════════════════
  # WIKI FILE OPERATIONS
  # ═══════════════════════════════════════════════════════════════════════════

  # GET /wiki/tree — file tree of wiki/ directory
  get "/wiki/tree" do
    require_project!
    tree = WikiEngine.file_tree(wiki_path, project_path: current_project_path)
    json(tree: tree)
  end

  # GET /wiki/page?path=wiki/concepts/foo.md — read a wiki page
  get "/wiki/page" do
    require_project!
    rel = utf8_param(body_or_query_param("path"))
    error!("path is required", status: 400) if rel.empty?
    full = safe_wiki_page_path(rel)
    error!("File not found", status: 404) unless File.exist?(full)
    error!("Not a file", status: 400) unless File.file?(full)
    content = File.read(full, encoding: "utf-8")
    fm = WikiEngine.parse_frontmatter(content)
    json(path: rel, content: content, frontmatter: fm, revision: Storage.revision(full))
  end

  # POST /wiki/asset — persist a document attachment outside the visible tree.
  post "/wiki/asset" do
    require_project!
    body = json_body
    filename = File.basename(body["filename"].to_s.strip)
    error!("filename is required", status: 400) if filename.empty?
    error!("Invalid filename", status: 400) if [".", ".."].include?(filename) || filename.match?(/[\x00-\x1f]/)
    extension = File.extname(filename).downcase
    content_type = WIKI_ASSET_TYPES[extension]
    error!("Unsupported attachment type", status: 415) unless content_type

    begin
      decoded = Base64.strict_decode64(body["content"].to_s)
    rescue ArgumentError
      error!("Invalid base64 content", status: 400)
    end
    error!("Attachment is larger than 25 MB", status: 413) if decoded.bytesize > MAX_WIKI_ASSET_BYTES

    asset_dir = File.join(current_project_path, "wiki", ".attachments")
    destination = Storage.with_lock(File.join(current_project_path, ".llm-wiki", "asset-upload.lock")) do
      FileUtils.mkdir_p(asset_dir)
      path = unique_path(File.join(asset_dir, filename))
      Storage.atomic_write(path, decoded, binary: true)
      path
    end
    relative = destination.sub("#{File.expand_path(current_project_path)}/", "").tr("\\", "/")
    ActivityLog.record(current_project_path, "attachment_uploaded", relative, actor: "user")
    json(ok: true, path: relative, name: File.basename(destination), content_type: content_type, image: WIKI_IMAGE_EXTENSIONS.include?(extension))
  end

  # GET /wiki/asset — serve an inline image or downloadable document attachment.
  get "/wiki/asset" do
    explicit_project = utf8_param(query["project"]).strip
    project = explicit_project.empty? ? current_project_path : File.expand_path(explicit_project)
    error!("No knowledge base is available", status: 400) unless project && compatible_project?(project)
    error!("Untrusted request origin", status: 403) unless trusted_local_origin?

    rel = utf8_param(query["path"]).tr("\\", "/")
    error!("path is required", status: 400) if rel.empty?
    full = safe_wiki_asset_path(rel, project)
    error!("Attachment not found", status: 404) unless File.file?(full)
    extension = File.extname(full).downcase
    content_type = WIKI_ASSET_TYPES[extension]
    error!("Unsupported attachment type", status: 415) unless content_type

    filename = File.basename(full)
    fallback = filename.encode("US-ASCII", invalid: :replace, undef: :replace, replace: "_").gsub(/[^A-Za-z0-9._-]/, "_")
    encoded = URI.encode_www_form_component(filename).gsub("+", "%20")
    disposition = query["download"].to_s == "1" ? "attachment" : "inline"
    raise Clacky::ApiExtension::Halt.new(200, File.binread(full), content_type, extra_headers: {
      "Content-Disposition" => %(#{disposition}; filename="#{fallback}"; filename*=UTF-8''#{encoded}),
      "Content-Length" => File.size(full).to_s,
      "Cache-Control" => "private, max-age=3600",
      "X-Content-Type-Options" => "nosniff"
    })
  end

  # POST /wiki/page — write/update a wiki page
  post "/wiki/page" do
    require_project!
    body = json_body
    rel = body["path"].to_s
    content = body["content"].to_s
    submitted_title = body.key?("title") ? body["title"].to_s.gsub(/[\r\n]+/, " ").strip : nil
    error!("path is required", status: 400) if rel.empty?
    error!("title is required", status: 400) if !submitted_title.nil? && submitted_title.empty?
    full = safe_wiki_page_path(rel)
    expected_revision = body["revision"].to_s
    current_revision = Storage.revision(full)
    error!("Destination already exists", status: 409) if body["create"] == true && current_revision
    frontmatter = WikiEngine.parse_frontmatter(content)
    body_kind = body["kind"].to_s.strip.downcase
    frontmatter_kind = frontmatter["kind"].to_s.strip.downcase
    valid_kinds = ["", "page", "category"]
    unless valid_kinds.include?(body_kind) && valid_kinds.include?(frontmatter_kind)
      error!("kind must be page or category", status: 422)
    end
    if !body_kind.empty? && !frontmatter_kind.empty? && body_kind != frontmatter_kind
      error!("Request kind must match frontmatter kind", status: 422)
    end
    unless current_revision
      relative_inside_wiki = rel.sub(%r{\Awiki/}, "")
      category_requested = body_kind == "category" || frontmatter_kind == "category"
      if category_requested && !File.basename(rel).casecmp("index.md").zero?
        error!("Categories must use an index.md landing page", status: 422)
      end
      if WikiEngine.sidebar_logical_conflict?(current_project_path, rel)
        error!("A page already uses the same sidebar location", status: 409)
      end

      parent_path = body["parent_path"].to_s.strip
      parent_directory = body["parent_directory"].to_s.tr("\\", "/").sub(%r{/\z}, "")
      if !parent_path.empty? && !parent_directory.empty?
        error!("Choose either a parent page or a parent directory, not both", status: 422)
      end
      has_parent = !parent_path.empty? || !parent_directory.empty?
      page_type = WikiEngine.canonical_page_type(
        current_project_path,
        frontmatter["type"],
        relative_inside_wiki
      )
      depth = WikiEngine.sidebar_content_depth(
        rel,
        page_type,
        project_path: current_project_path
      )
      if depth > WikiEngine::MAX_SIDEBAR_CONTENT_LEVEL
        error!("New items can only be created within the three-level knowledge tree", status: 422)
      end
      if has_parent && depth < 2
        error!("Child items must be created below their selected parent", status: 422)
      elsif !has_parent && depth != 1
        error!("Items without a parent must be created at the first visible content level", status: 422)
      end

      unless parent_path.empty?
        parent_full = safe_wiki_page_path(parent_path)
        error!("Parent page not found", status: 404) unless File.file?(parent_full)
        parent_content = File.read(parent_full, encoding: "utf-8")
        parent_frontmatter = WikiEngine.parse_frontmatter(parent_content)
        parent_type = WikiEngine.canonical_page_type(
          current_project_path,
          parent_frontmatter["type"],
          parent_path.sub(%r{\Awiki/}, "")
        )
        error!("Parent and child must use the same category", status: 422) unless parent_type == page_type
        parent_depth = WikiEngine.sidebar_content_depth(
          parent_path,
          parent_type,
          project_path: current_project_path,
          additional_paths: [rel]
        )
        unless depth == parent_depth + 1 && parent_depth < WikiEngine::MAX_SIDEBAR_CONTENT_LEVEL
          error!("New items must be created exactly one level beneath their selected parent", status: 422)
        end
        expected_parent_directory = "wiki/#{WikiEngine.sidebar_child_directory(parent_path)}"
        unless WikiEngine.sidebar_parent_directory(rel) == expected_parent_directory
          error!("New item must be created beneath the selected parent", status: 422)
        end
      end

      unless parent_directory.empty?
        error!("Invalid parent directory", status: 400) unless parent_directory.start_with?("wiki/")
        parent_full = safe_project_path(parent_directory)
        wiki_root = File.expand_path(File.join(current_project_path, "wiki"))
        error!("Invalid parent directory", status: 400) unless parent_full.start_with?("#{wiki_root}/")
        error!("Parent directory not found", status: 404) unless Dir.exist?(parent_full)
        canonical_parent_directory = parent_full.sub("#{File.expand_path(current_project_path)}/", "").tr("\\", "/")
        parent_depth = WikiEngine.sidebar_content_depth(
          "#{canonical_parent_directory}/index.md",
          page_type,
          project_path: current_project_path,
          additional_paths: [rel]
        )
        unless depth == parent_depth + 1 && parent_depth < WikiEngine::MAX_SIDEBAR_CONTENT_LEVEL
          error!("New items must be created exactly one level beneath their selected parent", status: 422)
        end
        unless WikiEngine.sidebar_parent_directory(rel) == canonical_parent_directory
          error!("New item must be created beneath the selected parent", status: 422)
        end
      end
    end
    if !expected_revision.empty? && expected_revision != current_revision
      error!("This page changed after you opened it. Reload before saving so newer changes are not overwritten.", status: 409)
    end
    content = WikiEngine.update_page_metadata(content, title: submitted_title) if submitted_title
    Storage.atomic_write(full, content, encoding: "utf-8")
    action = current_revision ? "page_updated" : "page_created"
    actor = body["actor"].to_s.strip
    actor = "user" if actor.empty?
    best_effort_after_commit("record completed edit") do
      ActivityLog.record(current_project_path, action, append_session_detail(rel), actor: actor) unless rel.downcase == ActivityLog::FILE
    end
    json(
      ok: true,
      path: rel,
      content: content,
      frontmatter: WikiEngine.parse_frontmatter(content),
      revision: Storage.revision(full)
    )
  end

  # POST /wiki/page/metadata — change a page's classification or visible title
  # without moving the file, so existing wikilinks remain stable.
  post "/wiki/page/metadata" do
    require_project!
    body = json_body
    rel = body["path"].to_s
    title = body.key?("title") ? body["title"].to_s.gsub(/[\r\n]+/, " ").strip : nil
    page_type = body.key?("type") ? WikiEngine.normalize_page_type(body["type"]) : nil
    error!("path is required", status: 400) if rel.empty?
    error!("title or type is required", status: 400) if title.nil? && page_type.nil?
    error!("title is required", status: 400) if !title.nil? && title.empty?
    error!("Invalid page type", status: 400) if page_type && page_type.match?(/[\\\/\r\n]/)
    full = safe_wiki_page_path(rel)
    error!("File not found", status: 404) unless File.file?(full)
    expected_revision = body["revision"].to_s
    current_revision = Storage.revision(full)
    if !expected_revision.empty? && expected_revision != current_revision
      error!("This page changed after you opened it. Reload before saving so newer changes are not overwritten.", status: 409)
    end
    content = File.read(full, encoding: "utf-8")
    updated = WikiEngine.update_page_metadata(content, title: title, type: page_type)
    Storage.atomic_write(full, updated, encoding: "utf-8")
    changes = []
    changes << "title=#{title}" if title
    changes << "type=#{page_type}" if page_type
    best_effort_after_commit("record completed edit") do
      ActivityLog.record(current_project_path, "page_metadata_updated", "#{rel} #{changes.join(' ')}", actor: "user")
    end
    json(
      ok: true,
      path: rel,
      content: updated,
      frontmatter: WikiEngine.parse_frontmatter(updated),
      revision: Storage.revision(full)
    )
  end

  # GET /sidebar/order — persistent per-type document order.
  get "/sidebar/order" do
    require_project!
    json(SidebarOrder.load(current_project_path))
  end

  # POST /sidebar/reorder — reorder inside a type or move to another type in
  # one operation. The file path stays stable, so existing wikilinks remain
  # valid while the visible classification and order change together.
  post "/sidebar/reorder" do
    require_project!
    body = json_body
    rel = body["path"].to_s
    target_type = body["target_type"].to_s
    error!("path is required", status: 400) if rel.empty?
    error!("target_type is required", status: 400) if target_type.empty?
    safe_wiki_page_path(rel)
    begin
      result = SidebarOrder.reorder(
        current_project_path,
        path: rel,
        target_type: target_type,
        target_index: body["target_index"]
      )
    rescue ArgumentError => error
      status = error.message == "File not found" ? 404 : 400
      error!(error.message, status: status)
    end
    detail = [
      rel,
      "type=#{result['old_type']}->#{result['type']}",
      "position=#{result['target_index'] + 1}",
      "before=#{result['before'] || '-'}",
      "after=#{result['after'] || '-'}"
    ].join(" ")
    best_effort_after_commit("record completed edit") do
      ActivityLog.record(current_project_path, "page_reordered", detail, actor: "user")
    end
    json(result)
  end

  # POST /sidebar/move — freely reparent a page tree and order it inside the
  # destination sibling list. Hierarchy and order are persisted together.
  post "/sidebar/move" do
    require_project!
    body = json_body
    rel = body["path"].to_s
    target_type = body["target_type"].to_s
    error!("path is required", status: 400) if rel.empty?
    error!("target_type is required", status: 400) if target_type.empty?
    safe_wiki_page_path(rel)
    begin
      result = SidebarOrder.move_tree(
        current_project_path,
        path: rel,
        target_type: target_type,
        target_parent: body["target_parent"],
        target_index: body["target_index"],
        target_path: body["target_path"],
        position: body["position"]
      )
    rescue ArgumentError => error
      status = case error.message
      when "File not found", "Parent page not found" then 404
      when "Destination already exists", "A page already uses the same sidebar location" then 409
      else 422
      end
      error!(error.message, status: status)
    end
    detail = [
      "#{result['from']}->#{result['to']}",
      "type=#{result['old_type']}->#{result['type']}",
      "parent=#{result['old_parent'] || '-'}->#{result['parent'] || '-'}",
      "position=#{result['target_index'] + 1}"
    ].join(" ")
    ActivityLog.record(current_project_path, "page_tree_moved", detail, actor: "user")
    json(result)
  end

  # POST /wiki/page/move — rename or move a page while keeping wikilinks valid
  post "/wiki/page/move" do
    require_project!
    body = json_body
    from = body["from"].to_s
    to = body["to"].to_s
    error!("from and to are required", status: 400) if from.empty? || to.empty?
    source = safe_wiki_page_path(from)
    destination = safe_wiki_page_path(to)
    error!("File not found", status: 404) unless File.file?(source)
    error!("Destination already exists", status: 409) if File.exist?(destination)
    source_content = File.read(source, encoding: "utf-8")
    source_frontmatter = WikiEngine.parse_frontmatter(source_content)
    source_kind = source_frontmatter["kind"].to_s.strip.downcase
    source_is_index_category = File.basename(from).casecmp("index.md").zero? &&
      source_kind != "page"
    if source_is_index_category && !File.basename(to).casecmp("index.md").zero?
      error!("Categories must use an index.md landing page", status: 422)
    end
    if WikiEngine.sidebar_logical_conflict?(current_project_path, to, excluding_paths: [from])
      error!("A page already uses the same sidebar location", status: 409)
    end
    descendants = WikiEngine.sidebar_descendant_pages(current_project_path, from)
    if descendants.any?
      error!("Move child items before moving this parent", status: 409)
    end
    page_type = WikiEngine.canonical_page_type(
      current_project_path,
      source_frontmatter["type"],
      from.sub(%r{\Awiki/}, "")
    )
    source_depth = WikiEngine.sidebar_content_depth(
      from,
      page_type,
      project_path: current_project_path
    )
    destination_depth = WikiEngine.sidebar_content_depth(
      to,
      page_type,
      project_path: current_project_path,
      excluding_paths: [from]
    )
    max_depth = WikiEngine::MAX_SIDEBAR_CONTENT_LEVEL
    invalid_legacy_move = destination_depth > max_depth &&
      (source_depth <= max_depth || destination_depth > source_depth)
    if invalid_legacy_move
      error!("Moves beyond the three-level tree must preserve or reduce an existing legacy depth", status: 422)
    end
    result = CascadeDelete.move_page(current_project_path, from, to)
    if result["ok"]
      best_effort_after_commit("record page move") do
        ActivityLog.record(current_project_path, "page_moved", "#{from} -> #{to}", actor: "user")
      end
    end
    json(result)
  end

  # DELETE /wiki/page with {"path":"wiki/concepts/foo.md"} — move a leaf
  # page to the OpenClacky trash. A query parameter remains accepted for
  # compatible hosts, but JSON is reliable through OpenClacky's proxy.
  delete "/wiki/page" do
    require_project!
    rel = utf8_param(body_or_query_param("path"))
    error!("path is required", status: 400) if rel.empty?
    full = safe_wiki_page_path(rel)
    error!("File not found", status: 404) unless File.file?(full)
    result = CascadeDelete.delete_page(current_project_path, rel)
    error!(result["error"], status: result["status"] || 409) unless result["ok"]
    best_effort_after_commit("record page trash") do
      ActivityLog.record(current_project_path, "page_trashed", rel, actor: "user")
    end
    json(result)
  end

  # GET /wiki/index — read wiki/index.md
  get "/wiki/index" do
    require_project!
    path = File.join(wiki_path, "index.md")
    content = File.exist?(path) ? File.read(path, encoding: "utf-8") : ""
    json(content: content)
  end

  # GET /wiki/schema — read schema.md
  get "/wiki/schema" do
    require_project!
    path = File.join(current_project_path, "schema.md")
    content = File.exist?(path) ? File.read(path, encoding: "utf-8") : ""
    json(content: content)
  end

  # POST /wiki/schema — write schema.md
  post "/wiki/schema" do
    require_project!
    body = json_body
    Storage.atomic_write(File.join(current_project_path, "schema.md"), body["content"].to_s, encoding: "utf-8")
    ActivityLog.record(current_project_path, "schema_updated", nil, actor: "user")
    json(ok: true)
  end

  # GET /wiki/purpose — read purpose.md
  get "/wiki/purpose" do
    require_project!
    path = File.join(current_project_path, "purpose.md")
    content = File.exist?(path) ? File.read(path, encoding: "utf-8") : ""
    json(content: content)
  end

  # POST /wiki/purpose — write purpose.md
  post "/wiki/purpose" do
    require_project!
    body = json_body
    Storage.atomic_write(File.join(current_project_path, "purpose.md"), body["content"].to_s, encoding: "utf-8")
    ActivityLog.record(current_project_path, "purpose_updated", nil, actor: "user")
    json(ok: true)
  end

  # POST /activity — lets mutating Wiki Assistant skills record their completed
  # work even when they edited Markdown with native file tools.
  post "/activity" do
    require_project!
    body = json_body
    action = body["action"].to_s.strip
    error!("action is required", status: 400) if action.empty?
    best_effort_after_commit("record completed edit") do
      ActivityLog.record(current_project_path, action, body["detail"], actor: body["actor"].to_s.strip.empty? ? "agent" : body["actor"])
    end
    json(ok: true)
  end

  # ═══════════════════════════════════════════════════════════════════════════
  # SOURCES
  # ═══════════════════════════════════════════════════════════════════════════

  # GET /sources — list source files
  get "/sources" do
    require_project!
    if query["path"] && !query["path"].to_s.empty?
      full = safe_source_path(query["path"])
      error!("Source not found", status: 404) unless File.file?(full)
      allowed = %w[.md .txt .csv .json .jsonl .yaml .yml .html .htm .xml .log .rst]
      error!("This source is not a text file", status: 415) unless allowed.include?(File.extname(full).downcase)
      limit = 256 * 1024
      content = File.open(full, "rb") { |file| file.read(limit + 1) || "" }
      truncated = content.bytesize > limit
      content = content.byteslice(0, limit) if truncated
      content.force_encoding(Encoding::UTF_8)
      # A byte limit may split the final UTF-8 character; reject binary data elsewhere.
      if truncated && !content.valid_encoding?
        3.times do
          break if content.valid_encoding?
          content = content.byteslice(0, content.bytesize - 1).force_encoding(Encoding::UTF_8)
        end
      end
      error!("This source is not UTF-8 text", status: 415) unless content.valid_encoding? && !content.include?("\0")
      json(name: File.basename(full), path: query["path"], content: content, truncated: truncated)
    else
      sources = WikiEngine.list_sources(current_project_path)
      json(sources: sources)
    end
  end

  # POST /sources/upload — upload a source file (base64 or text)
  post "/sources/upload" do
    require_project!
    body = json_body
    filename = File.basename(body["filename"].to_s.strip)
    content = body["content"].to_s
    encoding = body["encoding"].to_s # "base64" or "text"
    error!("filename is required", status: 400) if filename.empty?
    error!("Invalid filename", status: 400) if filename.match?(/[\x00-\x1f]/)

    source_dir = File.join(current_project_path, "raw", "sources")
    FileUtils.mkdir_p(source_dir)
    dest = File.join(source_dir, filename)
    error!("A source with this filename already exists", status: 409) if File.exist?(dest) && body["overwrite"] != true

    if encoding == "base64"
      require "base64"
      begin
        decoded = Base64.strict_decode64(content)
      rescue ArgumentError
        error!("Invalid base64 content", status: 400)
      end
      error!("Source is larger than 25 MB", status: 413) if decoded.bytesize > 25 * 1024 * 1024
      Storage.atomic_write(dest, decoded, binary: true)
    else
      error!("Source is larger than 25 MB", status: 413) if content.bytesize > 25 * 1024 * 1024
      Storage.atomic_write(dest, content, encoding: "utf-8")
    end
    best_effort_after_commit("record completed edit") do
      ActivityLog.record(current_project_path, "source_uploaded", "raw/sources/#{filename}", actor: "user")
    end
    json(ok: true, path: "raw/sources/#{filename}")
  end

  # DELETE /sources?path=raw/sources/file.md — remove an imported source.
  # Derived wiki pages remain reviewable; they can be removed independently
  # through the existing cascade-delete endpoint.
  delete "/sources" do
    require_project!
    rel = utf8_param(body_or_query_param("path"))
    error!("path is required", status: 400) if rel.empty?
    full = safe_source_path(rel)
    error!("Source not found", status: 404) unless File.file?(full)
    File.delete(full)
    prune_empty_source_dirs(File.dirname(full))
    ActivityLog.record(current_project_path, "source_deleted", rel, actor: "user")
    json(ok: true, path: rel)
  end

  # POST /sources/clip — web clipper endpoint (receives URL + content from browser)
  post "/sources/clip" do
    require_project!
    body = json_body
    url = body["url"].to_s
    title = body["title"].to_s.strip
    content = body["content"].to_s
    error!("url and content are required", status: 400) if url.empty? || content.empty?

    slug = WikiEngine.slugify(title.empty? ? url : title)
    filename = "#{slug}.md"
    source_dir = File.join(current_project_path, "raw", "sources")
    FileUtils.mkdir_p(source_dir)

    error!("Clipped content is larger than 25 MB", status: 413) if content.bytesize > 25 * 1024 * 1024
    destination = unique_path(File.join(source_dir, filename))
    filename = File.basename(destination)
    metadata = { "source_url" => url, "title" => title, "clipped_at" => Time.now.iso8601 }
    yaml = YAML.dump(metadata).sub(/\A---\s*\n/, "---\n")
    clip_content = "#{yaml}---\n\n#{content}"
    Storage.atomic_write(destination, clip_content, encoding: "utf-8")
    best_effort_after_commit("record completed edit") do
      ActivityLog.record(current_project_path, "source_clipped", "raw/sources/#{filename}", actor: "user")
    end
    json(ok: true, path: "raw/sources/#{filename}", filename: filename)
  end

  # ═══════════════════════════════════════════════════════════════════════════
  # INGEST
  # ═══════════════════════════════════════════════════════════════════════════

  # POST /ingest — trigger two-step ingest for a source file
  post "/ingest", timeout: 600 do
    require_project!
    body = json_body
    source_path = body["source_path"].to_s
    error!("source_path is required", status: 400) if source_path.empty?
    full_source = safe_source_path(source_path)
    error!("Source file not found", status: 404) unless File.exist?(full_source)

    # Check SHA256 cache — skip if unchanged
    cache_hit = Ingest.check_cache(current_project_path, source_path, full_source)
    if cache_hit
      json(status: "cached", files: cache_hit)
    else
      # Run two-step ingest (this calls the LLM via Clacky's own API)
      result = Ingest.run(current_project_path, source_path, full_source)
      ActivityLog.record(current_project_path, "source_ingested", "#{source_path} files=#{result[:files].length}", actor: "agent")
      json(status: "completed", files: result[:files], review_items: result[:review_items])
    end
  end

  # POST /ingest/batch — ingest multiple sources
  post "/ingest/batch", timeout: 600 do
    require_project!
    body = json_body
    paths = body["source_paths"]
    error!("source_paths array is required", status: 400) unless paths.is_a?(Array)

    results = paths.map do |sp|
      begin
        full = safe_source_path(sp)
      rescue
        next { path: sp, status: "invalid_path" }
      end
      next { path: sp, status: "not_found" } unless File.exist?(full)
      cache_hit = Ingest.check_cache(current_project_path, sp, full)
      if cache_hit
        { path: sp, status: "cached", files: cache_hit }
      else
        result = Ingest.run(current_project_path, sp, full)
        { path: sp, status: "completed", files: result[:files] }
      end
    end
    completed = results.count { |result| result[:status] == "completed" }
    ActivityLog.record(current_project_path, "sources_ingested", "completed=#{completed} requested=#{paths.length}", actor: "agent") if completed > 0
    json(results: results)
  end

  # ═══════════════════════════════════════════════════════════════════════════
  # KNOWLEDGE GRAPH
  # ═══════════════════════════════════════════════════════════════════════════

  # GET /graph — full graph data for visualization
  get "/graph", timeout: 180 do
    require_project!
    graph_data = Graph.build(current_project_path)
    json(graph_data)
  end

  # GET/POST /graph/config — project-local labels and colors for any page type
  get "/graph/config" do
    require_project!
    json(Graph.graph_config(current_project_path))
  end

  post "/graph/config" do
    require_project!
    saved = Graph.save_graph_config(current_project_path, json_body)
    ActivityLog.record(current_project_path, "type_labels_updated", "types=#{json_body.fetch('types', {}).keys.join(',')}", actor: "user")
    json(saved)
  end

  # DELETE /graph/config/type — remove an empty top-level classification.
  delete "/graph/config/type" do
    require_project!
    type = utf8_param(body_or_query_param("type")).strip
    error!("type is required", status: 400) if type.empty?
    result = Graph.delete_type(current_project_path, type)
    error!(result["error"], status: result["status"] || 409) unless result["ok"]
    ActivityLog.record(current_project_path, "type_deleted", result["deleted_type"], actor: "user")
    json(result)
  end

  # GET /graph/related?node=concept-name&limit=10
  get "/graph/related" do
    require_project!
    node_id = utf8_param(query["node"])
    limit = [[(query["limit"] || 10).to_i, 1].max, 100].min
    error!("node is required", status: 400) if node_id.empty?
    related = Graph.related_nodes(current_project_path, node_id, limit)
    json(related: related)
  end

  # GET /graph/communities — Louvain community detection
  get "/graph/communities" do
    require_project!
    communities = Graph.detect_communities(current_project_path)
    json(communities: communities)
  end

  # GET /graph/insights — surprise connections + knowledge gaps
  get "/graph/insights" do
    require_project!
    insights = Graph.compute_insights(current_project_path)
    json(insights)
  end

  # ═══════════════════════════════════════════════════════════════════════════
  # SEARCH
  # ═══════════════════════════════════════════════════════════════════════════

  # GET /search?q=query&limit=20
  get "/search" do
    require_project!
    query_string = utf8_param(query["q"])
    limit = [[(query["limit"] || 20).to_i, 1].max, 100].min
    error!("q is required", status: 400) if query_string.empty?
    results = Search.query(current_project_path, query_string, limit: limit)
    json(results: results, query: query_string)
  end

  # ═══════════════════════════════════════════════════════════════════════════
  # LINT
  # ═══════════════════════════════════════════════════════════════════════════

  # GET /lint — run structural lint (orphans, broken links, no-outlinks)
  get "/lint" do
    require_project!
    results = Lint.structural(current_project_path)
    json(results: results)
  end

  # ═══════════════════════════════════════════════════════════════════════════
  # DEEP RESEARCH
  # ═══════════════════════════════════════════════════════════════════════════

  # POST /research — start a deep research task
  post "/research", timeout: 600 do
    require_project!
    body = json_body
    topic = body["topic"].to_s.strip
    queries = body["queries"] || [topic]
    error!("topic is required", status: 400) if topic.empty?
    result = Research.execute(current_project_path, topic, queries)
    ActivityLog.record(current_project_path, "deep_research_completed", topic, actor: "agent")
    json(result)
  end

  # GET /research/tasks — list research tasks
  get "/research/tasks" do
    require_project!
    tasks = Research.list_tasks(current_project_path)
    json(tasks: tasks)
  end

  # ═══════════════════════════════════════════════════════════════════════════
  # REVIEW / AUDIT QUEUE
  # ═══════════════════════════════════════════════════════════════════════════

  # GET /review — list pending review items
  get "/review" do
    require_project!
    items = Review.list(current_project_path)
    json(items: items)
  end

  # POST /review/resolve — resolve a review item
  post "/review/resolve" do
    require_project!
    body = json_body
    item_id = body["id"].to_s
    action = body["action"].to_s # "accept", "dismiss", "research"
    error!("id and action are required", status: 400) if item_id.empty? || action.empty?
    result = Review.resolve(current_project_path, item_id, action)
    error!(result["error"], status: 404) unless result["ok"]
    ActivityLog.record(current_project_path, "review_resolved", "id=#{item_id} action=#{action}", actor: "user")
    json(result)
  end

  # ═══════════════════════════════════════════════════════════════════════════
  # SETTINGS
  # ═══════════════════════════════════════════════════════════════════════════

  # GET /settings — read project settings
  get "/settings" do
    settings = load_settings
    public_settings = settings.reject { |key, _| key == "search_api_key" }
    public_settings["search_api_key_configured"] = !settings["search_api_key"].to_s.empty?
    json(settings: public_settings)
  end

  # POST /settings — update settings
  post "/settings" do
    body = json_body
    submitted = body["settings"] || body
    error!("settings must be an object", status: 400) unless submitted.is_a?(Hash)
    current = load_settings
    allowed = %w[search_provider search_api_key output_language max_ingest_tokens searxng_url]
    submitted.each { |key, value| current[key] = value if allowed.include?(key) }
    save_settings(current)
    json(ok: true)
  end

  private

  # ── Project helpers ──────────────────────────────────────────────────────

  def projects_root
    @projects_root ||= File.join(ext_data_dir, "知识库")
  end

  def legacy_projects_root
    File.join(ext_data_dir, "projects")
  end

  def managed_project_roots
    [projects_root, legacy_projects_root].map { |path| File.expand_path(path) }.uniq
  end

  def provision_project(language)
    seed = "wiki-#{Time.now.strftime('%Y%m%d-%H%M%S')}-#{SecureRandom.hex(2)}"
    display_name = language == "English" ? "New Wiki" : "新知识库"
    # Initialize the final metadata once. The old two-write flow created a
    # normal project and then overwrote project-meta.json to make it
    # provisional; that second overwrite is exactly where native Windows file
    # semantics could fail during first-run onboarding.
    WikiEngine.initialize_project(
      File.join(projects_root, seed),
      display_name,
      template: "general",
      language: language,
      provisional: true
    )
  end

  def managed_project_path?(path)
    expanded = File.expand_path(path.to_s)
    managed_project_roots.any? { |root| expanded.start_with?("#{root}/") }
  end

  def reusable_wiki_session_id
    sid = request_session_id
    return nil if sid.empty? || !registry&.ensure(sid)

    session = registry.get(sid)
    agent = session && session[:agent]
    return nil unless agent && agent.agent_profile.name.to_s == "wiki-assistant"
    error!("Current Wiki Assistant is busy", status: 409) if session[:status] == :running
    return nil if SessionProjectBinding.get(ext_data_dir, sid)

    sid
  end

  def attach_session_to_project(session_id, path)
    error!("Session not found", status: 404) unless registry&.ensure(session_id)
    session = registry.get(session_id)
    agent = session && session[:agent]
    error!("Session agent is unavailable", status: 409) unless agent

    expanded = File.expand_path(path)
    previous_path = agent.working_dir
    previous_binding = SessionProjectBinding.get(ext_data_dir, session_id)
    begin
      agent.change_working_dir(expanded)
      session_manager&.save(agent.to_session_data)
      SessionProjectBinding.set(ext_data_dir, session_id, expanded)
    rescue StandardError
      restore_session_project(session_id, previous_path, previous_binding)
      raise
    end
    touch_project_access(expanded)
    expanded
  end

  def restore_session_working_dir(session_id, previous_path)
    restore_session_project(session_id, previous_path, nil)
  end

  def connect_wiki_session(path, name)
    sid = request_session_id
    if !sid.empty? && registry&.ensure(sid)
      session = registry.get(sid)
      agent = session && session[:agent]
      if agent && agent.agent_profile.name.to_s == "wiki-assistant"
        error!("Current Wiki Assistant is busy", status: 409) if session[:status] == :running
        previous_path = agent.working_dir
        previous_binding = SessionProjectBinding.get(ext_data_dir, sid)
        attached = false
        begin
          attach_session_to_project(sid, path)
          attached = true
          summary = registry.session_summary(sid) || { id: sid, name: name, working_dir: path }
          return [summary, true]
        rescue StandardError
          restore_session_project(sid, previous_path, previous_binding) if attached
          raise
        end
      end
    end

    existing_session_id = SessionProjectBinding.session_ids_for_project(ext_data_dir, path).find do |candidate|
      next false unless registry&.ensure(candidate)
      agent = registry.get(candidate)&.dig(:agent)
      agent && agent.agent_profile.name.to_s == "wiki-assistant"
    end
    if existing_session_id
      heal_session_working_dir(existing_session_id, File.expand_path(path))
      touch_project_access(path)
      summary = registry.session_summary(existing_session_id) || { id: existing_session_id, name: name, working_dir: path }
      return [summary, true]
    end

    created_session_id = nil
    begin
      created_session_id = create_session(
        name: name.to_s.strip.empty? ? "LLM Wiki" : name,
        working_dir: path,
        profile: "wiki-assistant",
        source: :manual
      )
      SessionProjectBinding.set(ext_data_dir, created_session_id, path)
      touch_project_access(path)
      summary = registry&.session_summary(created_session_id) || { id: created_session_id, name: name, working_dir: path }
      [summary, false]
    rescue StandardError
      discard_created_session(created_session_id) if created_session_id
      raise
    end
  end

  def restore_session_project(session_id, previous_path, previous_binding)
    failures = []
    session = registry&.get(session_id)
    agent = session && session[:agent]
    if agent && !previous_path.to_s.empty?
      begin
        agent.change_working_dir(previous_path)
      rescue StandardError => error
        failures << error
      end
      begin
        session_manager&.save(agent.to_session_data)
      rescue StandardError => error
        failures << error
      end
    end
    begin
      if previous_binding.to_s.empty?
        SessionProjectBinding.delete(ext_data_dir, session_id)
      else
        SessionProjectBinding.set(ext_data_dir, session_id, previous_binding)
      end
    rescue StandardError => error
      failures << error
    end
    unless failures.empty?
      messages = failures.map { |error| "#{error.class}: #{error.message}" }.join("; ")
      Clacky::Logger.warn("[llm-wiki] could not fully restore previous project for #{session_id}: #{messages}")
    end
    failures.empty?
  end

  def onboarding_lock_path
    File.join(ext_data_dir, "onboarding.lock")
  end

  def onboarding_results_path
    File.join(ext_data_dir, "onboarding-requests.json")
  end

  def cached_onboarding_result(request_id)
    entry = onboarding_request_entry(request_id)
    return nil unless entry.is_a?(Hash)

    project_path = entry["project_path"].to_s
    session_id = entry["session_id"].to_s
    return nil unless wiki_project?(project_path)
    return nil if session_id.empty? || !registry&.ensure(session_id)

    session = registry.session_summary(session_id) || { id: session_id, working_dir: project_path }
    {
      project: WikiEngine.project_info(project_path),
      session: session,
      status: "onboarding",
      reused_session: !!entry["reused_session"]
    }
  rescue JSON::ParserError, SystemCallError
    nil
  end

  def onboarding_request_entry(request_id)
    path = onboarding_results_path
    return nil unless File.file?(path)
    data = JSON.parse(File.read(path, encoding: "utf-8"))
    entry = data.is_a?(Hash) ? data.dig("requests", request_id) : nil
    if entry.is_a?(Hash)
      # Receipts written by 0.0.23 before staged recovery already represent a
      # successfully submitted assistant task.
      entry["stage"] = "assistant_started" if entry["stage"].to_s.empty?
      entry
    end
  rescue JSON::ParserError, SystemCallError
    nil
  end

  def latest_resumable_onboarding_entry
    return nil unless File.file?(onboarding_results_path)
    data = JSON.parse(File.read(onboarding_results_path, encoding: "utf-8"))
    requests = data.is_a?(Hash) && data["requests"].is_a?(Hash) ? data["requests"] : {}
    cutoff = Time.now - (24 * 60 * 60)
    requests.values.sort_by { |entry| entry["created_at"].to_s }.reverse.find do |entry|
      created_at = Time.parse(entry["created_at"].to_s) rescue nil
      path = entry["project_path"].to_s
      created_at && created_at >= cutoff && resumable_empty_project?(path)
    end
  rescue JSON::ParserError, SystemCallError
    nil
  end

  def resumable_empty_project?(path)
    return false unless wiki_project?(path) && managed_project_path?(path)
    project = WikiEngine.project_info(path)
    project["hidden"] != true && project["provisional"] == true &&
      project["page_count"].to_i.zero? && project["source_count"].to_i.zero?
  rescue SystemCallError
    false
  end

  def save_onboarding_result(request_id, project_path, session_id, reused_session, stage: "assistant_started", error: nil)
    Storage.update_json(onboarding_results_path, { "version" => 1, "requests" => {} }) do |data|
      data = { "version" => 1, "requests" => {} } unless data.is_a?(Hash)
      data["version"] = 1
      data["requests"] = {} unless data["requests"].is_a?(Hash)
      data["requests"][request_id] = {
        "project_path" => File.expand_path(project_path),
        "session_id" => session_id.to_s,
        "reused_session" => !!reused_session,
        "stage" => stage.to_s,
        "error" => error.to_s.empty? ? nil : error.to_s,
        "created_at" => Time.now.iso8601
      }
      # Receipts are tiny and only needed for retries. Bound the file forever.
      if data["requests"].size > 200
        keep = data["requests"].sort_by { |_id, entry| entry["created_at"].to_s }.last(200)
        data["requests"] = keep.to_h
      end
      data
    end
  end

  def halt_payload_message(halt)
    payload = JSON.parse(halt.payload.to_s)
    payload["error"].to_s.empty? ? halt.message : payload["error"].to_s
  rescue JSON::ParserError
    halt.message
  end

  def onboarding_failure!(message, stage:, request_id:, project:, session: nil, cause: nil)
    error!(
      message,
      status: 503,
      stage: stage,
      request_id: request_id,
      recoverable: true,
      project: WikiEngine.project_info(project["path"]),
      session: session,
      cause: cause
    )
  end

  def delete_onboarding_result(request_id)
    return unless File.file?(onboarding_results_path)
    Storage.update_json(onboarding_results_path, { "version" => 1, "requests" => {} }) do |data|
      data = { "version" => 1, "requests" => {} } unless data.is_a?(Hash)
      data["requests"] = {} unless data["requests"].is_a?(Hash)
      data["requests"].delete(request_id)
      data
    end
  rescue StandardError => error
    Clacky::Logger.warn("[llm-wiki] could not remove onboarding receipt #{request_id}: #{error.message}")
  end

  def discard_created_session(session_id)
    return if session_id.to_s.empty?
    SessionProjectBinding.delete(ext_data_dir, session_id)
    registry&.delete(session_id) if registry&.exist?(session_id)
    session_manager&.delete(session_id) if session_manager&.load(session_id)
  rescue StandardError => error
    Clacky::Logger.warn("[llm-wiki] could not discard incomplete session #{session_id}: #{error.message}")
  end

  def ext_data_dir
    @ext_data_dir ||= begin
      dir = File.expand_path("~/.clacky/ext/data/llm-wiki")
      FileUtils.mkdir_p(dir)
      dir
    end
  end

  def current_project_path
    sid = request_session_id
    unless sid.empty?
      # The conversation history can outlive browser state and working_dir can
      # be changed by other OpenClacky features. Recover the exact wiki that was
      # explicitly attached to this conversation, then repair the runtime cwd.
      # Never infer ownership from working_dir: a brand-new session can inherit
      # an unrelated directory that happens to contain another wiki.
      bound = SessionProjectBinding.get(ext_data_dir, sid)
      if bound && compatible_project?(bound)
        heal_session_working_dir(sid, bound)
        return bound
      end
      SessionProjectBinding.delete(ext_data_dir, sid) if bound
    end

    # Skills execute inside the Wiki Assistant's working directory and may use
    # the deterministic API from a terminal tool, where there is no browser
    # session header to forward. The explicit project header keeps those calls
    # session-scoped without bringing back a process-global "current project".
    path = request_project_path
    return File.expand_path(path) unless path.empty? || !trusted_local_origin? || !compatible_project?(path)

    # A global selection is an API default only. Do not change an arbitrary
    # session's working directory: coding, research, and other agents must keep
    # their own workspace while still being able to query the wiki.
    global_project_path
  end

  def global_project_path
    # Pausing disables automatic agent lookup, not manual access or the visual
    # workspace. The `/global-project` status is what global skills obey.
    selected_global_project_path
  end

  def selected_global_project_path
    path = GlobalProjectSelection.get(ext_data_dir)
    return nil unless path
    return path if compatible_project?(path)
    GlobalProjectSelection.clear(ext_data_dir)
    nil
  end

  def project_scope
    sid = request_session_id
    return "session" if !sid.empty? && SessionProjectBinding.get(ext_data_dir, sid) == current_project_path
    explicit = request_project_path
    return "explicit" unless explicit.empty?
    current_project_path ? "global" : "none"
  end

  def select_global_project(path, session_id: request_session_id, actor: "system")
    expanded = File.expand_path(path.to_s)
    GlobalProjectSelection.set(ext_data_dir, expanded)
    touch_project_access(expanded)
    best_effort_after_commit("remember global project") do
      remember_project(expanded) unless managed_project_path?(expanded)
    end
    detail = session_id.to_s.strip.empty? ? nil : "session=#{session_id}"
    best_effort_after_commit("record global project selection") do
      ActivityLog.record(expanded, "global_project_selected", detail, actor: actor)
    end
    expanded
  end

  def best_effort_after_commit(label)
    yield
  rescue StandardError => error
    begin
      Clacky::Logger.warn("[llm-wiki] #{label} failed after primary commit: #{error.class}: #{error.message}")
    rescue StandardError
      nil
    end
    nil
  end

  def session_log_detail
    request_session_id.empty? ? nil : "session=#{request_session_id}"
  end

  def append_session_detail(detail)
    session = session_log_detail
    [detail, session].compact.reject(&:empty?).join(" ")
  end

  def request_session_id
    @request_session_id ||= begin
      header = req["X-Clacky-Session-Id"].to_s.strip
      query_id = utf8_param(query["session_id"]).strip
      body_id = json_body["session_id"].to_s.strip
      header.empty? ? (query_id.empty? ? body_id : query_id) : header
    end
  end

  def request_project_path
    encoded = req["X-LLM-Wiki-Project-Uri"].to_s.strip
    unless encoded.empty?
      begin
        return URI.decode_www_form_component(encoded, Encoding::UTF_8).strip
      rescue ArgumentError
        error!("Invalid encoded project path", status: 400)
      end
    end

    # CLI clients may still send raw UTF-8 bytes, which WEBrick exposes as
    # ASCII-8BIT. Keep this fallback for existing skills and older clients.
    utf8_param(req["X-LLM-Wiki-Project"]).strip
  end

  def trusted_local_origin?
    origin = req["Origin"].to_s
    origin.empty? || origin.match?(%r{\Ahttps?://(?:127\.0\.0\.1|localhost)(?::\d+)?\z}i)
  end

  def wiki_project?(path)
    expanded = File.expand_path(path.to_s)
    return false if File.symlink?(expanded)
    wiki_dir = File.join(expanded, "wiki")
    meta_path = File.join(expanded, ".llm-wiki", "project-meta.json")
    schema_path = File.join(expanded, "schema.md")
    purpose_path = File.join(expanded, "purpose.md")
    # Structure alone is not proof of ownership: a large workspace root can
    # happen to contain wiki/, schema.md and purpose.md and get mistaken for a
    # knowledge base (this caused "open knowledge base" to jump into the wrong,
    # oversized directory). Require the .llm-wiki/project-meta.json identity
    # marker that the extension writes into every project it creates, so only
    # genuine knowledge bases qualify.
    File.file?(meta_path) && !File.symlink?(meta_path) &&
      Dir.exist?(wiki_dir) && !File.symlink?(wiki_dir) &&
      File.file?(schema_path) && !File.symlink?(schema_path) &&
      File.file?(purpose_path) && !File.symlink?(purpose_path)
  rescue SystemCallError
    false
  end

  # Versions before the stable project identity marker could remember an
  # existing knowledge base by path only. Keep those explicitly user-selected
  # paths visible when they still contain real Markdown pages under wiki/.
  # We deliberately do not scan arbitrary workspaces with this relaxed rule:
  # membership in recent-projects.json is the compatibility boundary.
  def remembered_legacy_project?(path)
    expanded = File.expand_path(path.to_s)
    return false unless Dir.exist?(expanded)
    return false if File.symlink?(expanded)
    return false unless known_legacy_project_paths.include?(expanded)

    wiki_root = File.join(expanded, "wiki")
    return false unless Dir.exist?(wiki_root) && !File.symlink?(wiki_root)
    Dir.glob(File.join(wiki_root, "**", "*.md")).any? do |page|
      File.file?(page) && !File.symlink?(page) &&
        !path_has_symlink_component?(page, expanded) &&
        !ActivityLog.hidden_page?(page.sub(%r{\A#{Regexp.escape(wiki_root)}/?}, ""))
    end
  rescue SystemCallError
    false
  end

  # Historical Wiki Assistant sessions are useful discovery evidence, but a
  # working directory alone is weaker than an explicit recent/global binding.
  # Require the full legacy scaffold so an ordinary workspace is never adopted
  # merely because an old conversation happened to run there.
  def historical_session_legacy_project?(path)
    expanded = File.expand_path(path.to_s)
    return false unless historical_session_project_paths.include?(expanded)
    return false unless Dir.exist?(expanded)
    return false if File.symlink?(expanded)
    purpose = File.join(expanded, "purpose.md")
    schema = File.join(expanded, "schema.md")
    return false unless File.file?(purpose) && !File.symlink?(purpose)
    return false unless File.file?(schema) && !File.symlink?(schema)

    real_knowledge_page?(expanded)
  rescue SystemCallError
    false
  end

  # A folder explicitly chosen by the user may be a portable legacy LLM Wiki
  # whose original OpenClacky history is not present on this machine. This
  # predicate is intentionally not part of compatible_project? or discovery:
  # explicit folder selection is the authorization boundary for migration.
  def portable_legacy_project?(path)
    expanded = File.expand_path(path.to_s)
    return false unless Dir.exist?(expanded)
    return false if File.symlink?(expanded)

    wiki_root = File.join(expanded, "wiki")
    purpose = File.join(expanded, "purpose.md")
    schema = File.join(expanded, "schema.md")
    return false unless Dir.exist?(wiki_root) && !File.symlink?(wiki_root)
    return false unless File.file?(purpose) && !File.symlink?(purpose)
    return false unless File.file?(schema) && !File.symlink?(schema)
    return false if path_has_symlink_component?(wiki_root, expanded)
    return false if path_has_symlink_component?(purpose, expanded)
    return false if path_has_symlink_component?(schema, expanded)
    return false if File.read(purpose, encoding: "utf-8").strip.empty?
    return false if File.read(schema, encoding: "utf-8").strip.empty?

    real_knowledge_page?(expanded)
  rescue Encoding::InvalidByteSequenceError, Encoding::UndefinedConversionError, SystemCallError
    false
  end

  def compatible_project?(path)
    wiki_project?(path) || remembered_legacy_project?(path) || historical_session_legacy_project?(path)
  end

  def legacy_project_name(path)
    expanded = File.expand_path(path.to_s)
    wiki_root = File.join(expanded, "wiki")
    candidates = [
      File.join(wiki_root, "index.md"),
      *Dir.glob(File.join(wiki_root, "**", "index.md")).sort
    ].uniq
    candidates.each do |candidate|
      next unless File.file?(candidate)
      heading = File.foreach(candidate, encoding: "utf-8").first(80).find { |line| line.match?(/\A#\s+\S/) }
      return heading.sub(/\A#\s+/, "").strip if heading
    rescue Encoding::InvalidByteSequenceError, Encoding::UndefinedConversionError
      next
    end
    File.basename(expanded).tr("_-", " ").split.map(&:capitalize).join(" ")
  end

  def project_info_for(path)
    info = WikiEngine.project_info(File.expand_path(path.to_s))
    if wiki_project?(path)
      return recover_contentful_project_info(path, info)
    end
    info.merge(
      "name" => legacy_project_name(path),
      "legacy_compatible" => true
    )
  end

  # A few early onboarding builds wrote real pages but never cleared the
  # provisional flag or replaced the placeholder name. Treat those projects as
  # established in read-only responses so they remain usable and recognizable.
  # Metadata is only persisted when the user explicitly opens/selects the wiki.
  def recover_contentful_project_info(path, info = WikiEngine.project_info(path))
    return info unless legacy_contentful_provisional_project?(path, info)

    stored_name = info["name"].to_s
    inferred_name = generic_project_name?(stored_name) ? infer_project_name_from_pages(path) : stored_name
    info.merge(
      "name" => inferred_name,
      "provisional" => false,
      "legacy_compatible" => true,
      "metadata_recovered" => true,
      "stored_name" => stored_name,
      "stored_provisional" => true
    )
  end

  def complete_contentful_project_metadata(path)
    expanded = File.expand_path(path.to_s)
    info = WikiEngine.project_info(expanded)
    return info unless legacy_contentful_provisional_project?(expanded, info)

    meta_path = File.join(expanded, ".llm-wiki", "project-meta.json")
    meta = JSON.parse(File.read(meta_path, encoding: "utf-8")) rescue {}
    stored_name = meta["name"].to_s
    meta["name"] = infer_project_name_from_pages(expanded) if generic_project_name?(stored_name)
    meta["provisional"] = false
    meta["format_version"] = 2
    meta["legacy_metadata_completed_at"] ||= Time.now.iso8601
    Storage.atomic_write(meta_path, JSON.pretty_generate(meta), encoding: "utf-8")
    best_effort_after_commit("record legacy metadata completion") do
      ActivityLog.record(expanded, "legacy_metadata_completed", "contentful provisional project", actor: "system")
    end
    WikiEngine.project_info(expanded)
  end

  # Current releases stamp project metadata with format_version=2. Only
  # contentful provisional projects created before that boundary are eligible
  # for the legacy onboarding repair. A current onboarding project may already
  # contain a page while the user is still confirming purpose and taxonomy; it
  # must remain provisional.
  def legacy_contentful_provisional_project?(path, info = WikiEngine.project_info(path))
    return false unless info["provisional"] == true && info["knowledge_page_count"].to_i.positive?

    meta_path = File.join(File.expand_path(path.to_s), ".llm-wiki", "project-meta.json")
    meta = JSON.parse(File.read(meta_path, encoding: "utf-8"))
    version = Integer(meta["format_version"] || 0) rescue 0
    version < 2
  rescue JSON::ParserError, SystemCallError
    false
  end

  def generic_project_name?(name)
    value = name.to_s.strip
    value.empty? ||
      value.match?(/\A(?:new wiki|new knowledge base|新知识库|新建知识库)\z/i) ||
      value.match?(/\Awiki-\d{8}-\d{6}-[0-9a-f]{4}\z/i)
  end

  def infer_project_name_from_pages(path)
    wiki_root = File.join(File.expand_path(path.to_s), "wiki")
    titles = Dir.glob(File.join(wiki_root, "**", "*.md")).sort.first(100).each_with_object([]) do |page, result|
      relative = page.sub(%r{\A#{Regexp.escape(wiki_root)}/?}, "")
      next if ActivityLog.hidden_page?(relative)
      content = File.read(page, encoding: "utf-8")
      title = WikiEngine.extract_title(content, page).to_s.gsub(/\s+/, " ").strip
      next if title.empty? || title.match?(/\A(?:index|overview|untitled|activity log)\z/i)
      result << title
    rescue Encoding::InvalidByteSequenceError, Encoding::UndefinedConversionError, SystemCallError
      next
    end

    subjects = titles.map { |title| title.split(/\s*(?:—|–|｜|\||：|:)\s*/, 2).first.to_s.strip }
      .reject(&:empty?)
    counts = subjects.each_with_object(Hash.new(0)) { |subject, tally| tally[subject] += 1 }
    repeated = counts.sort_by { |subject, count| [-count, subject.length] }.find { |_, count| count >= 2 }
    candidate = repeated&.first || subjects.first
    candidate = legacy_project_name(path) if candidate.to_s.empty?
    candidate.to_s[0, 80]
  end

  def real_knowledge_page?(path)
    wiki_root = File.join(File.expand_path(path.to_s), "wiki")
    return false unless Dir.exist?(wiki_root)

    Dir.glob(File.join(wiki_root, "**", "*.md")).any? do |page|
      relative = page.sub(%r{\A#{Regexp.escape(wiki_root)}/?}, "")
      next false if ActivityLog.hidden_page?(relative)
      !File.symlink?(page) &&
        !path_has_symlink_component?(page, File.expand_path(path.to_s)) &&
        !%w[index.md overview.md log.md].include?(relative.downcase)
    end
  end

  def path_has_symlink_component?(path, root)
    expanded_root = File.expand_path(root.to_s)
    current = File.expand_path(path.to_s)
    while current.start_with?("#{expanded_root}/")
      return true if File.symlink?(current)
      current = File.dirname(current)
    end
    false
  rescue SystemCallError
    true
  end

  def legacy_project_inspection(path)
    expanded = File.expand_path(path.to_s)
    project = project_info_for(expanded)
    {
      "path" => expanded,
      "name" => project["name"],
      "kind" => "llm-wiki-legacy",
      "kind_label" => "LLM Wiki",
      "markdown_count" => project["knowledge_page_count"],
      "compatible" => true,
      "requires_import" => false,
      "legacy_compatible" => true,
      "project" => project
    }
  end

  def migrate_compatible_legacy_project(path, allow_explicit_portable: false)
    expanded = File.expand_path(path.to_s)
    return WikiEngine.project_info(expanded) if wiki_project?(expanded)
    compatible = compatible_project?(expanded)
    portable = allow_explicit_portable && portable_legacy_project?(expanded)
    raise ArgumentError, "Not an LLM Wiki project" unless compatible || portable

    WikiEngine.initialize_project(
      expanded,
      legacy_project_name(expanded),
      template: "general",
      language: "",
      provisional: false
    )
  end

  # Retained for callers from the 0.0.28 compatibility layer.
  def migrate_remembered_legacy_project(path)
    migrate_compatible_legacy_project(path)
  end

  def preflight_project_session_binding!(allow_running: false)
    sid = request_session_id
    error!("A Wiki Assistant session is required", status: 400) if sid.empty?
    error!("Session not found", status: 404) unless registry&.ensure(sid)
    session = registry.get(sid)
    agent = session && session[:agent]
    error!("Session agent is unavailable", status: 409) unless agent
    error!("A Wiki Assistant session is required", status: 400) unless agent.agent_profile.name.to_s == "wiki-assistant"
    error!("Current Wiki Assistant is busy", status: 409) if session[:status] == :running && !allow_running
    true
  end

  # Legacy initialization touches only these infrastructure files. Snapshot
  # their exact bytes so a failed session connection or global-selection write
  # cannot leave an old knowledge base half-migrated.
  def with_project_bootstrap_rollback(path)
    expanded = File.expand_path(path.to_s)
    Storage.with_lock(project_bootstrap_lock_path(expanded)) do
      tracked_files = [
        ".llm-wiki/project-meta.json",
        ".llm-wiki/activity-log.lock",
        "purpose.md",
        "schema.md",
        ActivityLog::FILE
      ]
      tracked_directories = %w[.llm-wiki raw/sources raw wiki]
      file_state = tracked_files.each_with_object({}) do |relative, result|
        file = File.join(expanded, relative)
        result[relative] = File.file?(file) ? File.binread(file) : nil
      end
      directory_state = tracked_directories.each_with_object({}) do |relative, result|
        result[relative] = Dir.exist?(File.join(expanded, relative))
      end

      begin
        yield
      rescue Exception
        tracked_files.each do |relative|
          file = File.join(expanded, relative)
          original = file_state[relative]
          if original.nil?
            File.delete(file) if File.file?(file) || File.symlink?(file)
          else
            Storage.atomic_write(file, original, binary: true)
          end
        rescue SystemCallError
          nil
        end
        tracked_directories.each do |relative|
          next if directory_state[relative]
          directory = File.join(expanded, relative)
          Dir.rmdir(directory) if Dir.exist?(directory) && Dir.empty?(directory)
        rescue SystemCallError
          nil
        end
        raise
      end
    end
  end

  def project_bootstrap_lock_path(path)
    digest = Digest::SHA256.hexdigest(File.expand_path(path.to_s))
    File.join(ext_data_dir, "project-bootstrap-locks", "#{digest}.lock")
  end

  def bind_session_to_project(path)
    sid = request_session_id
    error!("A Wiki Assistant session is required", status: 400) if sid.empty?
    attach_session_to_project(sid, path)
  end

  def verify_session_project_attachment!(session_id, project_path)
    expected = File.expand_path(project_path.to_s)
    bound = SessionProjectBinding.get(ext_data_dir, session_id)
    error!("Wiki Assistant project binding failed", status: 503) unless bound == expected

    session = registry&.get(session_id)
    agent = session && session[:agent]
    actual = agent && File.expand_path(agent.working_dir.to_s)
    error!("Wiki Assistant working directory is incorrect", status: 503) unless actual == expected
    true
  end

  def heal_session_working_dir(session_id, path)
    return unless registry&.ensure(session_id)
    agent = nil
    registry.with_session(session_id) { |entry| agent = entry[:agent] }
    return unless agent && File.expand_path(agent.working_dir.to_s) != path
    agent.change_working_dir(path)
    session_manager&.save(agent.to_session_data)
  rescue StandardError
    # The durable binding still keeps deterministic wiki APIs usable. A later
    # request retries the runtime repair if the agent is briefly unavailable.
    nil
  end

  def require_project!
    error!("This OpenClacky conversation is not connected to an LLM Wiki project yet. Create or open one first.", status: 400) unless current_project_path && Dir.exist?(current_project_path.to_s)
  end

  def wiki_path
    File.join(current_project_path, "wiki")
  end

  # WEBrick does not populate req.query from the URL query string for DELETE
  # requests. Prefer JSON, retain the normal parsed-query path, then decode the
  # raw query string so older clients continue to work with Unicode paths.
  def body_or_query_param(name)
    key = name.to_s
    body_value = json_body[key]
    return body_value unless body_value.to_s.strip.empty?

    query_value = query[key]
    return query_value unless query_value.to_s.strip.empty?

    URI.decode_www_form(req.query_string.to_s, Encoding::UTF_8).reverse_each do |query_key, value|
      return value if query_key == key && !value.to_s.strip.empty?
    end
    nil
  rescue ArgumentError, EncodingError
    nil
  end

  def utf8_param(value)
    value.to_s.dup.force_encoding(Encoding::UTF_8)
  end

  def safe_project_path(relative_path)
    base = File.expand_path(current_project_path)
    full = File.expand_path(File.join(base, relative_path))
    error!("Invalid path", status: 400) unless full == base || full.start_with?("#{base}/")
    full
  end

  def safe_wiki_page_path(relative_path)
    relative = relative_path.to_s.tr("\\", "/")
    error!("Invalid wiki page path", status: 400) unless relative.start_with?("wiki/") && relative.downcase.end_with?(".md")
    safe_scoped_path(relative, File.join(current_project_path, "wiki"))
  end

  def safe_source_path(relative_path)
    relative = relative_path.to_s.tr("\\", "/")
    error!("Invalid source path", status: 400) unless relative.start_with?("raw/sources/")
    safe_scoped_path(relative, File.join(current_project_path, "raw", "sources"))
  end

  def safe_wiki_asset_path(relative_path, project_path = current_project_path)
    relative = relative_path.to_s.tr("\\", "/")
    error!("Invalid attachment path", status: 400) unless relative.start_with?("wiki/.attachments/")
    error!("Unsupported attachment type", status: 415) unless WIKI_ASSET_TYPES.key?(File.extname(relative).downcase)

    project = File.expand_path(project_path.to_s)
    scope = File.expand_path(File.join(project, "wiki", ".attachments"))
    full = File.expand_path(File.join(project, relative))
    error!("Invalid attachment path", status: 400) unless full.start_with?("#{scope}/")
    error!("Symbolic links are not allowed in managed paths", status: 400) if File.symlink?(full)

    current = File.dirname(full)
    while current.start_with?(scope)
      error!("Symbolic links are not allowed in managed paths", status: 400) if File.symlink?(current)
      break if current == scope
      current = File.dirname(current)
    end
    full
  end

  def safe_scoped_path(relative_path, scope)
    full = safe_project_path(relative_path)
    expanded_scope = File.expand_path(scope)
    error!("Invalid path", status: 400) unless full.start_with?("#{expanded_scope}/")
    error!("Symbolic links are not allowed in managed paths", status: 400) if File.symlink?(full)

    current = File.dirname(full)
    while current.start_with?(expanded_scope)
      error!("Symbolic links are not allowed in managed paths", status: 400) if File.symlink?(current)
      break if current == expanded_scope
      current = File.dirname(current)
    end
    full
  end

  def unique_path(path)
    return path unless File.exist?(path)
    ext = File.extname(path)
    base = path.delete_suffix(ext)
    index = 2
    candidate = "#{base}-#{index}#{ext}"
    while File.exist?(candidate)
      index += 1
      candidate = "#{base}-#{index}#{ext}"
    end
    candidate
  end

  def prune_empty_source_dirs(dir)
    root = File.expand_path(File.join(current_project_path, "raw", "sources"))
    current = File.expand_path(dir)
    while current.start_with?("#{root}/") && Dir.exist?(current) && Dir.empty?(current)
      Dir.rmdir(current)
      current = File.dirname(current)
    end
  end

  def list_projects
    FileUtils.mkdir_p(projects_root)
    discovered = auto_discovered_project_paths
    paths = (known_legacy_project_paths + historical_session_project_paths + discovered)
      .map { |path| File.expand_path(path) }
      .uniq
    global_path = selected_global_project_path
    global_enabled = GlobalProjectSelection.enabled?(ext_data_dir)
    access = project_access_times
    projects = paths.select { |path| compatible_project?(path) }.each_with_object([]) do |path, result|
      project = project_info_for(path)
      next if project["hidden"] == true || transient_empty_onboarding_project?(path, project)
      result << project.merge(
        "managed" => managed_project_path?(path),
        "auto_discovered" => discovered.include?(path),
        "global_selected" => path == global_path,
        "global_enabled" => path == global_path && global_enabled,
        "last_opened_at" => access[path] || project["updated_at"]
      )
    end
    projects.concat(recoverable_project_rows)
    projects.sort_by { |project| project["last_opened_at"].to_s }.reverse
  end

  def legacy_recovery_candidates(recovered_ids: recovered_legacy_ids)
    LegacyProjectRecovery.candidates(
      sessions_root: sessions_root,
      snapshots_root: snapshots_root,
      recovered_ids: recovered_ids
    )
  rescue StandardError => error
    Clacky::Logger.warn("[llm-wiki] legacy recovery discovery failed: #{error.message}")
    []
  end

  def recoverable_project_rows
    legacy_recovery_candidates.map do |candidate|
      path_hints = Array(candidate["original_paths"] || candidate["path_hints"]).map(&:to_s).reject(&:empty?)
      path_hint = candidate["original_path"].to_s
      path_hint = path_hints.first if path_hint.empty?
      {
        "name" => candidate["name"],
        "path" => path_hint,
        "original_path" => path_hint,
        "original_paths" => path_hints,
        "recovery_id" => candidate["recovery_id"],
        "content_manifest_id" => candidate["content_manifest_id"],
        "recoverable" => true,
        "legacy_compatible" => true,
        "managed" => false,
        "provisional" => false,
        "path_reused" => candidate["path_reused"] == true,
        "conflict_count" => candidate["conflict_count"].to_i,
        "source_session_count" => Array(candidate["source_session_ids"]).length,
        "page_count" => candidate["page_count"].to_i,
        "knowledge_page_count" => candidate["page_count"].to_i,
        "source_count" => candidate["source_count"].to_i,
        "created_at" => candidate["created_at"],
        "updated_at" => candidate["updated_at"],
        "last_opened_at" => candidate["updated_at"]
      }
    end
  end

  def recovered_project_for_id(recovery_id, candidate: nil)
    suffix = recovery_id.to_s.sub(/\Alegacy-/, "")
    return nil unless suffix.match?(/\A[0-9a-f]{24}\z/)

    managed_project_roots.each do |root|
      project_path = File.join(root, "wiki-recovered-#{suffix}")
      next unless wiki_project?(project_path)
      next unless LegacyProjectRecovery.valid_receipt?(
        project_path: project_path,
        recovery_id: recovery_id,
        candidate: candidate
      )
      return project_info_for(project_path)
    end
    nil
  end

  def recovered_legacy_ids
    managed_project_roots.flat_map do |root|
      Dir.glob(File.join(root, "*", ".llm-wiki", "recovery.json")).each_with_object([]) do |receipt_path, result|
        receipt = JSON.parse(File.read(receipt_path, encoding: "utf-8"))
        recovery_id = receipt.is_a?(Hash) ? receipt["recovery_id"].to_s : ""
        next unless recovery_id.match?(/\Alegacy-[0-9a-f]{24}\z/)
        project_path = File.expand_path(File.join(File.dirname(receipt_path), ".."))
        next unless LegacyProjectRecovery.valid_receipt?(
          project_path: project_path,
          recovery_id: recovery_id
        )
        result << recovery_id
      rescue JSON::ParserError, SystemCallError
        next
      end
    end.uniq
  end

  def transient_empty_onboarding_project?(path, project = WikiEngine.project_info(path))
    return false unless managed_project_path?(path)
    return false unless project["page_count"].to_i.zero? && project["source_count"].to_i.zero?
    return true if project["provisional"] == true

    # 0.0.25 could leave a seed directory before project metadata was safely
    # persisted. These paths have no user content and displayed as dozens of
    # raw `wiki-<timestamp>` rows on the welcome page.
    seed_name = File.basename(path).match?(/\Awiki-\d{8}-\d{6}-[0-9a-f]{4}\z/i)
    meta_path = File.join(path, ".llm-wiki", "project-meta.json")
    seed_name && !File.file?(meta_path)
  end

  def project_access_path
    File.join(ext_data_dir, "project-access.json")
  end

  def project_access_times
    return {} unless File.file?(project_access_path)
    data = JSON.parse(File.read(project_access_path, encoding: "utf-8"))
    values = data.is_a?(Hash) && data["access"].is_a?(Hash) ? data["access"] : {}
    values.each_with_object({}) { |(path, at), result| result[File.expand_path(path.to_s)] = at.to_s }
  rescue JSON::ParserError, SystemCallError
    {}
  end

  def touch_project_access(path, at: Time.now)
    expanded = File.expand_path(path.to_s)
    timestamp = at.respond_to?(:iso8601) ? at.iso8601 : at.to_s
    Storage.update_json(project_access_path, { "version" => 1, "access" => {} }) do |data|
      data = { "version" => 1, "access" => {} } unless data.is_a?(Hash)
      data["access"] = {} unless data["access"].is_a?(Hash)
      data["access"][expanded] = timestamp
      data["access"] = data["access"].sort_by { |_, value| value.to_s }.reverse.first(200).to_h
      data
    end
  rescue StandardError => error
    Clacky::Logger.warn("[llm-wiki] could not record recent project #{expanded}: #{error.message}")
    nil
  end

  def recent_projects_path
    File.join(ext_data_dir, "recent-projects.json")
  end

  def remembered_project_paths
    return [] unless File.file?(recent_projects_path)
    data = JSON.parse(File.read(recent_projects_path, encoding: "utf-8"))
    data.is_a?(Hash) && data["paths"].is_a?(Array) ? data["paths"] : []
  rescue JSON::ParserError, SystemCallError
    []
  end

  def legacy_state_project_paths
    path = File.join(ext_data_dir, "state.json")
    return [] unless File.file?(path)
    data = JSON.parse(File.read(path, encoding: "utf-8"))
    current = data.is_a?(Hash) ? data["current_project"].to_s.strip : ""
    current.empty? ? [] : [File.expand_path(current)]
  rescue JSON::ParserError, SystemCallError
    []
  end

  def backup_binding_project_paths
    Dir.glob(File.join(ext_data_dir, "session-projects.json.bak-*")).sort.each_with_object([]) do |path, result|
      data = JSON.parse(File.read(path, encoding: "utf-8"))
      bindings = data.is_a?(Hash) && data["bindings"].is_a?(Hash) ? data["bindings"] : {}
      bindings.each_value do |entry|
        value = entry.is_a?(Hash) ? entry["path"] : entry
        result << File.expand_path(value.to_s) unless value.to_s.strip.empty?
      end
    rescue JSON::ParserError, SystemCallError
      next
    end.uniq
  end

  def sessions_root
    @sessions_root ||= File.expand_path("~/.clacky/sessions")
  end

  def snapshots_root
    @snapshots_root ||= File.expand_path("~/.clacky/snapshots")
  end

  def historical_session_project_paths
    return @historical_session_project_paths if defined?(@historical_session_project_paths)
    @historical_session_project_paths = []
    return @historical_session_project_paths unless Dir.exist?(sessions_root)

    Dir.glob(File.join(sessions_root, "*.json")).sort.each do |session_path|
      data = JSON.parse(File.read(session_path, encoding: "utf-8"))
      next unless data.is_a?(Hash) && data["agent_profile"].to_s == "wiki-assistant"
      value = data["working_dir"].to_s.strip
      next if value.empty?
      expanded = File.expand_path(value)
      normalized = expanded.tr("\\", "/")
      next if normalized.include?("/.clacky/snapshots/") || normalized.include?("/.clacky/trash/")
      @historical_session_project_paths << expanded
    rescue JSON::ParserError, SystemCallError
      next
    end
    @historical_session_project_paths.uniq!
    @historical_session_project_paths
  end

  def known_legacy_project_paths
    managed = managed_project_roots.flat_map { |root| Dir.glob(File.join(root, "*")) }
    paths = managed +
      remembered_project_paths +
      SessionProjectBinding.project_paths(ext_data_dir) +
      backup_binding_project_paths +
      legacy_state_project_paths
    selected = GlobalProjectSelection.get(ext_data_dir)
    paths << selected if selected
    paths.map { |path| File.expand_path(path.to_s) }.uniq
  end

  def project_discovery_path
    File.join(ext_data_dir, "project-discovery.json")
  end

  def project_discovery_roots
    return @project_discovery_roots if defined?(@project_discovery_roots)

    home = File.expand_path("~")
    conventional = %w[Documents Desktop Downloads Projects Workspace workspaces].map { |name| File.join(home, name) }
    named_home_folders = Dir.glob(File.join(home, "*")).select do |path|
      File.directory?(path) && File.basename(path).match?(/(?:wiki|knowledge|vault|obsidian|clacky)/i)
    rescue SystemCallError
      false
    end
    @project_discovery_roots = (managed_project_roots + conventional + named_home_folders)
      .map { |path| File.expand_path(path) }
      .select { |path| Dir.exist?(path) }
      .uniq
  end

  def auto_discovered_project_paths
    cache_path = project_discovery_path
    if File.file?(cache_path) && Time.now - File.mtime(cache_path) < 30
      cached = JSON.parse(File.read(cache_path, encoding: "utf-8"))
      paths = cached.is_a?(Hash) && cached["paths"].is_a?(Array) ? cached["paths"] : []
      return paths.map { |path| File.expand_path(path.to_s) }.select { |path| wiki_project?(path) }.uniq
    end

    paths = scan_project_markers
    Storage.atomic_write(
      cache_path,
      JSON.pretty_generate({ "version" => 1, "scanned_at" => Time.now.iso8601, "paths" => paths }),
      encoding: "utf-8"
    )
    paths
  rescue JSON::ParserError, SystemCallError => error
    Clacky::Logger.warn("[llm-wiki] local project discovery failed: #{error.message}")
    []
  end

  def scan_project_markers
    ignored = Set.new(%w[
      .git .svn .hg node_modules vendor Library Applications Movies Music Pictures
      .Trash .cache .npm .pnpm-store dist build coverage tmp
    ])
    found = []
    project_discovery_roots.each do |root|
      Find.find(root) do |entry|
        relative = entry == root ? "" : entry.delete_prefix("#{root}/")
        depth = relative.empty? ? 0 : relative.split(File::SEPARATOR).length
        if File.directory?(entry)
          name = File.basename(entry)
          if entry != root && (depth > 6 || (name.start_with?(".") && name != ".llm-wiki") || ignored.include?(name))
            Find.prune
          end
          next
        end
        next unless File.basename(entry) == "project-meta.json" && File.basename(File.dirname(entry)) == ".llm-wiki"

        project_path = File.expand_path(File.join(File.dirname(entry), ".."))
        found << project_path if wiki_project?(project_path)
      rescue Errno::EACCES, Errno::ENOENT, Errno::ENOTDIR
        next
      end
    end
    found.uniq
  end

  def remember_project(path)
    expanded = File.expand_path(path)
    Storage.update_json(recent_projects_path, { "version" => 1, "paths" => [] }) do |data|
      data = { "version" => 1, "paths" => [] } unless data.is_a?(Hash)
      data["paths"] = [] unless data["paths"].is_a?(Array)
      data["paths"] = ([expanded] + data["paths"].map { |item| File.expand_path(item.to_s) }).uniq.first(50)
      data
    end
  end

  def forget_project(path)
    expanded = File.expand_path(path)
    if File.file?(recent_projects_path)
      Storage.update_json(recent_projects_path, { "version" => 1, "paths" => [] }) do |data|
        data = { "version" => 1, "paths" => [] } unless data.is_a?(Hash)
        data["paths"] = [] unless data["paths"].is_a?(Array)
        data["paths"].reject! { |item| File.expand_path(item.to_s) == expanded }
        data
      end
    end
    if File.file?(project_access_path)
      Storage.update_json(project_access_path, { "version" => 1, "access" => {} }) do |data|
        data = { "version" => 1, "access" => {} } unless data.is_a?(Hash)
        data["access"] = {} unless data["access"].is_a?(Hash)
        data["access"].delete(expanded)
        data
      end
    end
  end

  def load_settings
    settings_file = File.join(ext_data_dir, "settings.json")
    return default_settings unless File.exist?(settings_file)
    JSON.parse(File.read(settings_file))
  rescue
    default_settings
  end

  def save_settings(settings)
    settings_file = File.join(ext_data_dir, "settings.json")
    Storage.atomic_write(settings_file, JSON.pretty_generate(settings))
  end

  def default_settings
    {
      "search_provider" => "tavily",
      "search_api_key" => "",
      "output_language" => "auto",
      "max_ingest_tokens" => 8192
    }
  end
end

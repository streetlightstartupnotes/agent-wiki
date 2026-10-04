# frozen_string_literal: true

require "digest/sha2"
require "fileutils"
require "json"
require "securerandom"
require "set"
require "time"

require_relative "storage"
require_relative "activity_log"
require_relative "wiki_engine"

# Reconstructs legacy LLM Wiki projects from OpenClacky Time Machine evidence.
# Snapshot directories are evidence, never live project paths.
# Session working directories are mutable hints; content lineage is identity.
module LegacyProjectRecovery
  extend self

  TOMBSTONE_SUFFIX = "..clacky-absent"
  RECOVERY_VERSION = 2
  CACHE_TTL_SECONDS = 5.0
  MAX_SESSIONS = 2_000
  MAX_FILES = 10_000
  MAX_FILE_BYTES = 32 * 1024 * 1024
  MAX_TOTAL_BYTES = 512 * 1024 * 1024
  INSTALL_MARKER = ".llm-wiki-recovery-install.json"
  ROOT_STARTER_PAGES = %w[wiki/index.md wiki/overview.md wiki/log.md].freeze
  META_JSON_ALLOWLIST = %w[
    project-meta.json
    graph-config.json
    sidebar-order.json
    research-tasks.json
    review-queue.json
  ].freeze

  class RecoveryError < StandardError; end
  class InvalidCandidate < RecoveryError; end
  class InvalidReceipt < RecoveryError; end
  class DestinationExists < RecoveryError; end
  class UnsafeSnapshot < RecoveryError; end

  # Return content-lineage candidates. recovered_ids suppress exact recovery
  # receipts only; paths and session IDs are deliberately not recovery keys.
  def candidates(sessions_root:, snapshots_root:, recovered_ids: [])
    session_root = safe_root(sessions_root)
    snapshot_root = safe_root(snapshots_root)
    return [] unless session_root && snapshot_root

    rows = cached_candidates(session_root, snapshot_root)
    recovered = exact_recovery_ids(recovered_ids)
    deep_copy(rows.reject { |candidate| recovered.include?(candidate["recovery_id"]) })
  end

  # Clear the short discovery cache. Tests and callers that just changed the
  # snapshot/session stores can force a fresh content scan.
  def clear_cache!
    cache_mutex.synchronize { @candidate_cache = {} }
    true
  end

  # Let the handler serialize candidate selection and restore under one lock.
  def recovery_lock(destination_root:)
    destination = prepare_destination_root(destination_root)
    Storage.with_lock(File.join(destination, ".legacy-project-recovery.lock")) do
      yield
    end
  end

  # Restore a signed candidate into a fresh managed directory.
  def restore(candidate:, destination_root:)
    data = stringify_hash(candidate)
    validate_candidate_signature!(data)

    requested_destination = File.expand_path(destination_root.to_s)
    destination = prepare_destination_root(destination_root)
    snapshot_root = canonical_existing_directory(data["_snapshot_root"])
    raise InvalidCandidate, "Snapshot root is unavailable" unless snapshot_root
    if within_path?(destination, snapshot_root)
      raise InvalidCandidate, "Destination cannot be inside the snapshot store"
    end

    recovery_id = data["recovery_id"].to_s
    expected_id = recovery_id_for(data["incarnation_id"], data["content_manifest_id"])
    unless recovery_id.match?(/\Alegacy-[0-9a-f]{24}\z/) && secure_equal?(recovery_id, expected_id)
      raise InvalidCandidate, "Invalid recovery identity"
    end

    destination_name = recovered_directory_name(recovery_id)
    final_path = File.join(destination, destination_name)
    logical_final_path = File.join(requested_destination, destination_name)
    ensure_direct_child!(final_path, destination)
    target_lock = File.join(destination, ".#{destination_name}.install.lock")
    ensure_direct_child!(target_lock, destination)

    Storage.with_lock(target_lock) do
      recover_interrupted_install!(final_path, data)
      raise DestinationExists, "Recovery destination already exists" if path_exists?(final_path)

      temporary_path = File.join(destination, ".llm-wiki-recovery-#{Process.pid}-#{SecureRandom.hex(8)}")
      ensure_direct_child!(temporary_path, destination)
      claimed = false
      begin
        Dir.mkdir(temporary_path, 0o700)
        files = normalized_virtual_files(data["virtual_files"])
        enforce_resolved_limits!(files)
        files.each do |relative_path, descriptor|
          copy_verified_file(
            descriptor: descriptor,
            relative_path: relative_path,
            destination_path: File.join(temporary_path, relative_path),
            snapshot_root: snapshot_root
          )
        end
        verify_recovered_files!(temporary_path, files)

        WikiEngine.initialize_project(
          temporary_path,
          data["name"].to_s.empty? ? fallback_name(data["original_path"]) : data["name"].to_s,
          template: data["template"].to_s.empty? ? "general" : data["template"].to_s,
          language: data["language"].to_s,
          provisional: false
        )
        verify_recovered_files!(temporary_path, immutable_files(files))

        file_sha256 = project_file_sha256(temporary_path)
        write_recovery_metadata(temporary_path, data, file_sha256)
        verify_hash_manifest!(temporary_path, file_sha256)

        # mkdir is the portable no-replace claim. The identity-bearing
        # .llm-wiki directory is moved last, so project discovery never sees a
        # partially installed wiki.
        raise DestinationExists, "Recovery destination already exists" if path_exists?(final_path)
        Dir.mkdir(final_path, 0o700)
        claimed = true
        write_install_marker!(final_path, data)
        install_temporary_project!(temporary_path, final_path)
        validate_receipt!(
          project_path: final_path,
          recovery_id: recovery_id,
          candidate: data
        )
        File.delete(File.join(final_path, INSTALL_MARKER))
      rescue Errno::EEXIST
        FileUtils.rm_rf(final_path) if claimed && File.directory?(final_path)
        raise DestinationExists, "Recovery destination already exists"
      rescue Exception
        # Only remove a directory claimed by this invocation. A pre-existing
        # destination is never overwritten or recursively removed.
        FileUtils.rm_rf(final_path) if claimed && File.directory?(final_path)
        raise
      ensure
        FileUtils.rm_rf(temporary_path) if File.directory?(temporary_path)
      end
    end

    WikiEngine.project_info(logical_final_path).merge(
      "path" => logical_final_path,
      "recovery_id" => recovery_id,
      "content_manifest_id" => data["content_manifest_id"],
      "original_path" => data["original_path"],
      "session_id" => data["session_id"],
      "source_session_ids" => Array(data["source_session_ids"])
    )
  end

  # Strictly validate the signed recovery-time checksum manifest and current
  # project structure. Pages remain editable after a successful restoration.
  def validate_receipt!(project_path:, recovery_id: nil, candidate: nil)
    path = canonical_existing_directory(project_path)
    raise InvalidReceipt, "Recovered project directory is unavailable" unless path

    receipt_path = File.join(path, ".llm-wiki", "recovery.json")
    stat = File.lstat(receipt_path) rescue nil
    unless stat && stat.file? && !stat.symlink? && stat.size <= MAX_FILE_BYTES
      raise InvalidReceipt, "Recovery receipt is unavailable"
    end

    receipt = JSON.parse(File.read(receipt_path, encoding: "utf-8"))
    raise InvalidReceipt, "Invalid recovery receipt" unless receipt.is_a?(Hash)
    raise InvalidReceipt, "Unsupported recovery receipt version" unless receipt["version"].to_i == RECOVERY_VERSION
    supplied_signature = receipt["receipt_signature"].to_s
    unless supplied_signature.match?(/\A[0-9a-f]{64}\z/) &&
        secure_equal?(supplied_signature, receipt_signature(receipt))
      raise InvalidReceipt, "Recovery receipt signature mismatch"
    end

    receipt_id = receipt["recovery_id"].to_s
    manifest_id = receipt["content_manifest_id"].to_s
    incarnation_id = receipt["incarnation_id"].to_s
    unless manifest_id.match?(/\A[0-9a-f]{64}\z/) && !incarnation_id.empty?
      raise InvalidReceipt, "Recovery receipt manifest identity is invalid"
    end
    expected_id = recovery_id_for(incarnation_id, manifest_id)
    raise InvalidReceipt, "Recovery receipt identity mismatch" unless secure_equal?(receipt_id, expected_id)
    unless File.basename(path) == recovered_directory_name(receipt_id)
      raise InvalidReceipt, "Recovered directory name does not match its receipt"
    end
    if recovery_id && !secure_equal?(receipt_id, recovery_id.to_s)
      raise InvalidReceipt, "Unexpected recovery ID"
    end

    if candidate
      expected = stringify_hash(candidate)
      %w[recovery_id content_manifest_id incarnation_id].each do |key|
        unless secure_equal?(receipt[key].to_s, expected[key].to_s)
          raise InvalidReceipt, "Receipt does not match candidate #{key}"
        end
      end
    end

    expected_hashes = receipt["file_sha256"]
    raise InvalidReceipt, "Receipt checksum manifest is missing" unless expected_hashes.is_a?(Hash)
    expected_hashes.each do |relative_path, sha|
      unless allowed_project_path?(relative_path.to_s) &&
          sha.to_s.match?(/\A[0-9a-f]{64}\z/)
        raise InvalidReceipt, "Unsafe receipt checksum entry"
      end
    end
    # The signed SHA manifest proves what was sealed at recovery time. Wiki
    # pages remain editable afterward, so receipt validation must not compare
    # their current bytes forever. A strict live scan still rejects symlinks,
    # unsafe structure, or a project that is no longer a reconstructable wiki.
    raise InvalidReceipt, "Recovered project structure is invalid" unless scan_live_project(path)
    receipt
  rescue JSON::ParserError, EncodingError, SystemCallError => error
    raise InvalidReceipt, "Invalid recovery receipt: #{error.message}"
  end

  def valid_receipt?(project_path:, recovery_id: nil, candidate: nil)
    !validate_receipt!(
      project_path: project_path,
      recovery_id: recovery_id,
      candidate: candidate
    ).nil?
  rescue RecoveryError
    false
  end

  private

  def cached_candidates(session_root, snapshot_root)
    key = [session_root, snapshot_root]
    now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    cache_mutex.synchronize do
      @candidate_cache ||= {}
      cached = @candidate_cache[key]
      return deep_copy(cached[:rows]) if cached && now - cached[:at] < CACHE_TTL_SECONDS
    end

    rows = discover_candidates(session_root, snapshot_root)
    cache_mutex.synchronize do
      @candidate_cache ||= {}
      @candidate_cache[key] = { at: now, rows: deep_copy(rows) }
    end
    rows
  end

  def discover_candidates(session_root, snapshot_root)
    observations = []
    session_count = 0
    each_regular_json(session_root) do |session_path|
      break if session_count >= MAX_SESSIONS
      session = read_json_file(session_path)
      next unless session.is_a?(Hash)
      next unless session["agent_profile"].to_s == "wiki-assistant"

      session_count += 1
      session_id = normalized_session_id(session["session_id"] || session["id"])
      next unless session_id
      observations.concat(build_observations(session, session_id, snapshot_root))
    end

    group_observations(observations).each_with_object([]) do |component, result|
      candidate = build_component_candidate(component, snapshot_root)
      result << candidate if candidate
    end.sort_by do |candidate|
      [sort_time(candidate["updated_at"]), candidate["name"].to_s, candidate["recovery_id"]]
    end.reverse
  end

  def build_observations(session, session_id, snapshot_root)
    snapshot_dir = safe_snapshot_directory(snapshot_root, session_id)
    return [] unless snapshot_dir

    tasks = active_snapshot_tasks(session, snapshot_dir)
    return [] if tasks.empty?

    budget = { files: 0, bytes: 0 }
    phases = []
    tasks.each do |task_id, task_dir|
      %w[before after].each do |phase|
        files = scan_phase(File.join(task_dir, phase), snapshot_root, budget)
        next unless files
        phases << {
          "task_id" => task_id,
          "phase" => phase,
          "files" => files,
          "identity" => phase_project_identity(files)
        }
      end
    end
    return [] if phases.empty?

    # A project-meta tombstone closes an epoch. Its phase is deliberately not
    # replayed: project-level deletion is evidence that the old wiki existed,
    # not a reason to erase the only recoverable copy. Ordinary page
    # tombstones remain part of their epoch and are still applied.
    segments = []
    current = nil
    phases.each do |phase|
      identity = phase["identity"]
      if identity["state"] == "close"
        mark_terminal_boundary_phase!(current, phase["task_id"])
        current = nil
        next
      end

      if current.nil? ||
          (identity["state"] == "file" && !same_epoch_identity?(current, identity))
        mark_terminal_boundary_phase!(current, phase["task_id"]) if current
        current = {
          "project_id" => identity["project_id"],
          "meta_created_at" => identity["created_at"],
          "identity_key" => identity["key"],
          "phases" => [],
          "ordinal" => segments.length
        }
        segments << current
      elsif identity["state"] == "file"
        current["project_id"] ||= identity["project_id"]
        current["meta_created_at"] ||= identity["created_at"]
        current["identity_key"] ||= identity["key"]
      end
      current["phases"] << phase
    end

    segments.each_with_object([]) do |segment, result|
      observation = build_epoch_observation(
        session,
        session_id,
        snapshot_root,
        segment
      )
      result << observation if observation
    end
  rescue UnsafeSnapshot, SystemCallError, JSON::ParserError
    []
  end

  def phase_project_identity(files)
    descriptor = files[".llm-wiki/project-meta.json"]
    if descriptor && descriptor["state"] != "file"
      return { "state" => "close" }
    end
    if project_close_phase?(files)
      return { "state" => "close" }
    end
    return { "state" => "missing" } unless descriptor

    meta = descriptor_json(descriptor)
    project_id = normalized_project_id(meta["project_id"])
    created_at = normalized_time(meta["created_at"])
    fallback = descriptor["sha256"].to_s
    key = if project_id
      "project:#{project_id}"
    elsif created_at
      "created:#{created_at}"
    else
      "meta:#{fallback}"
    end
    {
      "state" => "file",
      "project_id" => project_id,
      "created_at" => created_at,
      "key" => key
    }
  end

  def project_close_phase?(files)
    purpose = files["purpose.md"]
    schema = files["schema.md"]
    return false unless purpose && purpose["state"] == "absent"
    return false unless schema && schema["state"] == "absent"
    files.any? do |path, entry|
      knowledge_page?(path) && entry["state"] == "absent"
    end
  end

  def mark_terminal_boundary_phase!(segment, task_id)
    return unless segment
    phase = segment["phases"].reverse.find do |item|
      item["task_id"] == task_id && item["phase"] == "before"
    end
    phase["terminal"] = true if phase
  end

  def same_epoch_identity?(segment, identity)
    current_project_id = segment["project_id"]
    next_project_id = identity["project_id"]
    if current_project_id && next_project_id
      return secure_equal?(current_project_id, next_project_id)
    end

    current_created_at = segment["meta_created_at"]
    next_created_at = identity["created_at"]
    if current_created_at && next_created_at
      return secure_equal?(current_created_at, next_created_at)
    end

    current_key = segment["identity_key"]
    current_key.nil? || secure_equal?(current_key, identity["key"])
  end

  def build_epoch_observation(session, session_id, snapshot_root, segment)
    graph = {}
    anchors = Set.new
    before_anchors = Set.new
    trace_state = {}
    by_task = {}
    terminal_before_tasks = Set.new
    segment["phases"].each do |phase|
      by_task[phase["task_id"]] ||= {}
      by_task[phase["task_id"]][phase["phase"]] = phase["files"]
      terminal_before_tasks << phase["task_id"] if phase["phase"] == "before" && phase["terminal"]
    end
    by_task.keys.sort.each do |task_id|
      before = by_task[task_id]["before"]
      after = by_task[task_id]["after"]
      before ||= {}

      paths = Set.new(before.keys)
      Array(after && after.keys).each { |path| paths << path }
      paths.each do |relative_path|
        before_entry = before[relative_path]
        after_entry = after && after[relative_path]
        previous_token = trace_state[relative_path]
        before_token = add_graph_entry(
          graph, relative_path, before_entry, session_id, task_id, "before",
          task_rank(session, task_id, "before")
        )
        after_token = add_graph_entry(
          graph, relative_path, after_entry, session_id, task_id, "after",
          task_rank(session, task_id, "after")
        )
        if after_token && before_token
          if previous_token && previous_token != before_token
            graph[relative_path]["edges"][previous_token] << before_token
          end
          graph[relative_path]["edges"][before_token] << after_token
        elsif after_token && previous_token && previous_token != after_token
          # Some early Time Machine snapshots contain an AFTER delta without
          # its matching BEFORE entry. Along the active ancestry it still
          # causally replaces the previously resolved state.
          graph[relative_path]["edges"][previous_token] << after_token
        elsif before_token && terminal_before_tasks.include?(task_id)
          if previous_token && previous_token != before_token
            graph[relative_path]["edges"][previous_token] << before_token
          end
          graph[relative_path]["nodes"][before_token]["observed_after"] = true
        end
        trace_state[relative_path] = before_token if previous_token.nil? && before_token
        trace_state[relative_path] = before_token if terminal_before_tasks.include?(task_id) && before_token
        trace_state[relative_path] = after_token if after_token
      end

      [before, after].compact.each_with_index do |phase, phase_index|
        phase.each do |relative_path, entry|
          next unless entry["state"] == "file"
          if wiki_markdown_page?(relative_path)
            anchor = "#{relative_path}\0#{entry["sha256"]}"
            anchors << anchor
            before_anchors << anchor if phase_index.zero?
          end
        end
      end
    end
    return nil if graph.empty?

    path_hint = normalized_path_hint(session["working_dir"], snapshot_root)
    {
      "session_id" => session_id,
      "observation_id" => "#{session_id}:epoch-#{segment["ordinal"]}",
      "path_hint" => path_hint,
      "created_at" => normalized_time(session["created_at"]),
      "updated_at" => normalized_time(session["updated_at"]),
      "project_id" => segment["project_id"],
      "anchors" => anchors,
      "before_anchors" => before_anchors,
      "identity_versions" => identity_versions_for(graph),
      "graph" => graph
    }
  end

  def identity_versions_for(graph)
    %w[purpose.md schema.md .llm-wiki/project-meta.json].each_with_object({}) do |path, result|
      path_graph = graph[path]
      next unless path_graph
      result[path] = path_graph["nodes"].values.each_with_object(Set.new) do |node, hashes|
        hashes << node["sha256"] if node["state"] == "file"
      end
    end
  end

  def active_snapshot_tasks(session, snapshot_dir)
    available = {}
    Dir.children(snapshot_dir).each do |entry|
      match = entry.match(/\Atask-(\d+)\z/)
      next unless match
      path = File.join(snapshot_dir, entry)
      stat = File.lstat(path) rescue nil
      next unless stat && stat.directory? && !stat.symlink?
      available[match[1].to_i] = path
    end
    return [] if available.empty?

    machine = session["time_machine"]
    if machine.is_a?(Hash)
      parents = machine["task_parents"]
      active = integer_value(machine["active_task_id"] || machine["current_task_id"])
      if parents.is_a?(Hash) && active && active > 0
        chain = []
        visited = Set.new
        task_id = active
        while task_id && task_id > 0 && !visited.include?(task_id)
          visited << task_id
          chain << task_id
          task_id = integer_value(parents[task_id.to_s] || parents[task_id])
        end
        return chain.reverse.each_with_object([]) do |id, result|
          result << [id, available[id]] if available[id]
        end
      end
    end
    available.keys.sort.map { |id| [id, available[id]] }
  end

  def task_rank(session, task_id, phase)
    machine = session["time_machine"]
    meta = machine.is_a?(Hash) && machine["task_meta"].is_a?(Hash) ?
      machine["task_meta"][task_id.to_s] : nil
    numeric = if meta.is_a?(Hash)
      started_at = Float(meta["started_at"]) rescue nil
      ended_at = Float(meta["ended_at"]) rescue nil
      phase == "before" ? started_at : [started_at, ended_at].compact.max
    end
    return numeric + (phase == "after" ? 0.000_001 : 0.0) if numeric

    base = sort_time(session["created_at"])
    base + task_id.to_i + (phase == "after" ? 0.5 : 0.0)
  end

  def add_graph_entry(graph, relative_path, entry, session_id, task_id, phase, rank)
    return nil unless entry
    path_graph = graph[relative_path] ||= {
      "nodes" => {},
      "edges" => Hash.new { |hash, key| hash[key] = Set.new }
    }
    token = "occ:#{session_id}:#{task_id}:#{phase}"
    content_key = entry["state"] == "file" ? "sha:#{entry["sha256"]}" : "absent"
    node = path_graph["nodes"][token]
    observed_before = (node && node["observed_before"] == true) || phase == "before"
    observed_after = (node && node["observed_after"] == true) || phase == "after"
    source_session_ids = Array(node && node["source_session_ids"]) | [session_id]
    if node.nil? || rank >= node["rank"].to_f
      node = entry.merge(
        "token" => token,
        "content_key" => content_key,
        "rank" => rank,
        "session_id" => session_id,
        "task_id" => task_id,
        "phase" => phase,
        "observed_before" => observed_before,
        "observed_after" => observed_after,
        "source_session_ids" => source_session_ids
      )
      path_graph["nodes"][token] = node
    else
      node["observed_before"] = observed_before
      node["observed_after"] = observed_after
      node["source_session_ids"] = source_session_ids
    end
    token
  end

  def group_observations(observations)
    count = observations.length
    parents = (0...count).to_a
    explicit_ids = observations.map do |observation|
      id = observation["project_id"]
      id ? Set.new([id]) : Set.new
    end

    find_root = lambda do |index|
      while parents[index] != index
        parents[index] = parents[parents[index]]
        index = parents[index]
      end
      index
    end
    union = lambda do |left, right|
      left_root = find_root.call(left)
      right_root = find_root.call(right)
      next if left_root == right_root
      combined_ids = explicit_ids[left_root] | explicit_ids[right_root]
      next if combined_ids.length > 1
      parents[right_root] = left_root
      explicit_ids[left_root] = combined_ids
    end

    by_project = Hash.new { |hash, key| hash[key] = [] }
    observations.each_with_index do |observation, index|
      by_project[observation["project_id"]] << index if observation["project_id"]
    end
    by_project.values.each do |indices|
      session_counts = indices.each_with_object(Hash.new(0)) do |index, counts|
        counts[observations[index]["session_id"]] += 1
      end
      # Reusing even the same explicit ID after a project-level deletion is a
      # new same-session epoch. Only IDs that occur once per source session
      # are safe to union without further content-lineage evidence.
      unambiguous = indices.select do |index|
        session_counts[observations[index]["session_id"]] == 1
      end
      first = unambiguous.first
      Array(unambiguous.drop(1)).each { |index| union.call(first, index) } if first
    end

    # A single copied page is not enough to prove that two independent wikis
    # are the same incarnation. Merge only when components share at least two
    # exact path+SHA anchors, one is a real knowledge page, and a BEFORE
    # observation proves parent-state continuity.
    loop do
      roots = (0...count).map { |index| find_root.call(index) }.uniq
      component_indices = Hash.new { |hash, key| hash[key] = [] }
      (0...count).each { |index| component_indices[find_root.call(index)] << index }
      merged_any = false
      qualifying_pairs = roots.combination(2).select do |left_root, right_root|
        left_indices = component_indices[left_root]
        right_indices = component_indices[right_root]
        conservative_lineage_match?(observations, left_indices, right_indices)
      end

      # Do not let an unlabelled bridge attach to whichever of two explicit
      # projects happens to be visited first.
      ambiguous_unlabelled_roots = Set.new
      roots.each do |root|
        next unless explicit_ids[find_root.call(root)].empty?
        neighbor_ids = qualifying_pairs.each_with_object(Set.new) do |(left, right), ids|
          neighbor = left == root ? right : (right == root ? left : nil)
          next unless neighbor
          explicit_ids[find_root.call(neighbor)].each { |id| ids << id }
        end
        ambiguous_unlabelled_roots << root if neighbor_ids.length > 1
      end

      qualifying_pairs.each do |left_root, right_root|
        left_explicit = explicit_ids[find_root.call(left_root)]
        right_explicit = explicit_ids[find_root.call(right_root)]
        next if ambiguous_unlabelled_roots.include?(left_root) && !right_explicit.empty?
        next if ambiguous_unlabelled_roots.include?(right_root) && !left_explicit.empty?
        previous_left = find_root.call(left_root)
        previous_right = find_root.call(right_root)
        union.call(previous_left, previous_right)
        if find_root.call(previous_left) == find_root.call(previous_right)
          merged_any = true
          break
        end
      end
      break unless merged_any
    end

    groups = Hash.new { |hash, key| hash[key] = [] }
    observations.each_with_index do |observation, index|
      groups[find_root.call(index)] << observation
    end
    groups.values
  end

  def conservative_lineage_match?(observations, left_indices, right_indices)
    left_sessions = left_indices.map { |index| observations[index]["session_id"] }.to_set
    right_sessions = right_indices.map { |index| observations[index]["session_id"] }.to_set
    # Multiple observations from one session are explicit epoch boundaries
    # (project identity change or project-meta deletion/recreation). Never
    # stitch those epochs back together through copied template pages.
    return false unless (left_sessions & right_sessions).empty?

    left_anchors = left_indices.flat_map { |index| observations[index]["anchors"].to_a }.to_set
    right_anchors = right_indices.flat_map { |index| observations[index]["anchors"].to_a }.to_set
    shared = left_anchors & right_anchors
    return false if shared.length < 2
    return false unless shared.any? { |anchor| knowledge_page?(anchor.split("\0", 2).first) }

    left_before = left_indices.flat_map { |index| observations[index]["before_anchors"].to_a }.to_set
    right_before = right_indices.flat_map { |index| observations[index]["before_anchors"].to_a }.to_set
    continuity = (left_before & right_anchors) | (right_before & left_anchors)
    return false if continuity.empty?

    smaller_size = [left_anchors.length, right_anchors.length].min
    ratio = smaller_size.zero? ? 0.0 : shared.length.to_f / smaller_size
    return false unless shared.length >= 3 || (continuity.length >= 2 && ratio >= 0.75)
    identity_versions_compatible?(observations, left_indices, right_indices)
  end

  def identity_versions_compatible?(observations, left_indices, right_indices)
    %w[purpose.md schema.md .llm-wiki/project-meta.json].all? do |path|
      left = left_indices.flat_map do |index|
        versions = observations[index]["identity_versions"][path]
        versions ? versions.to_a : []
      end.to_set
      right = right_indices.flat_map do |index|
        versions = observations[index]["identity_versions"][path]
        versions ? versions.to_a : []
      end.to_set
      left.empty? || right.empty? || !(left & right).empty?
    end
  end

  def build_component_candidate(component, snapshot_root)
    resolved = resolve_component_graph(component)
    primary_files = resolved["primary_files"]
    return nil unless reconstructable_wiki?(primary_files)

    virtual_files = primary_files.dup
    occupied = Set.new(virtual_files.keys)
    conflicts = []
    resolved["conflicts"].each do |conflict|
      stored_versions = []
      conflict["alternate_nodes"].each do |node|
        if node["state"] == "file"
          conflict_path = conflict_storage_path(conflict["path"], node["sha256"], occupied)
          descriptor = public_descriptor(node).merge("conflict_for" => conflict["path"])
          virtual_files[conflict_path] = descriptor
          stored_versions << {
            "state" => "file",
            "sha256" => node["sha256"],
            "stored_path" => conflict_path,
            "source_session_ids" => Array(node["source_session_ids"]).sort
          }
        else
          stored_versions << {
            "state" => "absent",
            "sha256" => nil,
            "stored_path" => nil,
            "source_session_ids" => Array(node["source_session_ids"]).sort
          }
        end
      end
      conflicts << {
        "path" => conflict["path"],
        "primary_sha256" => conflict["primary"] && conflict["primary"]["sha256"],
        "versions" => stored_versions
      }
    end
    validate_virtual_paths!(virtual_files)
    enforce_resolved_limits!(virtual_files)

    project_ids = component.map { |item| item["project_id"] }.compact.uniq
    return nil if project_ids.length > 1
    anchors = component.flat_map { |item| item["anchors"].to_a }.uniq.sort
    incarnation_id = incarnation_id_for(project_ids.first, component)
    aliases = component.map { |item| "session:#{item["session_id"]}" }
    aliases.concat(anchors.map { |anchor| "anchor:#{Digest::SHA256.hexdigest(anchor)[0, 24]}" })
    aliases << "project:#{project_ids.first}" if project_ids.first
    aliases = aliases.uniq.sort

    content_manifest = content_manifest_for(virtual_files)
    content_manifest_id = Digest::SHA256.hexdigest(JSON.generate(content_manifest.sort))
    recovery_id = recovery_id_for(incarnation_id, content_manifest_id)
    path_hints = component.map { |item| item["path_hint"] }.compact.uniq.sort
    return nil if live_covers_manifest?(
      path_hints,
      content_manifest,
      snapshot_root,
      project_ids.first
    )

    meta = descriptor_json(primary_files[".llm-wiki/project-meta.json"])
    primary_path = path_hints.first
    page_count = primary_files.keys.count { |path| knowledge_page?(path) }
    source_count = primary_files.keys.count { |path| path.start_with?("raw/sources/") }
    source_sessions = component.map { |item| item["session_id"] }.uniq.sort
    created_values = component.map { |item| item["created_at"] }.compact
    updated_values = component.map { |item| item["updated_at"] }.compact
    occupied_paths = path_hints.select { |path| path_exists?(path) }

    candidate = {
      "id" => recovery_id,
      "recovery_id" => recovery_id,
      "content_manifest_id" => content_manifest_id,
      "incarnation_id" => incarnation_id,
      "incarnation_aliases" => aliases,
      "project_id" => project_ids.first,
      "name" => candidate_name(meta, primary_files, primary_path),
      "session_id" => source_sessions.first,
      "source_session_ids" => source_sessions,
      "original_path" => primary_path,
      "original_paths" => path_hints,
      "path_hint" => primary_path,
      "path_reused" => !occupied_paths.empty?,
      "path_status" => occupied_paths.empty? ? "missing" : "path_reused",
      "page_count" => page_count,
      "source_count" => source_count,
      "file_count" => virtual_files.length,
      "conflict_count" => conflicts.length,
      "conflicts" => conflicts,
      "created_at" => created_values.min,
      "updated_at" => updated_values.max,
      "template" => meta["template"].to_s.empty? ? "general" : meta["template"].to_s,
      "language" => meta["language"].to_s,
      "content_manifest" => content_manifest,
      "virtual_files" => virtual_files,
      "_snapshot_root" => snapshot_root
    }
    candidate["_integrity"] = candidate_signature(candidate)
    candidate
  rescue UnsafeSnapshot, SystemCallError
    nil
  end

  def resolve_component_graph(component)
    merged = {}
    component.each do |observation|
      observation["graph"].each do |path, graph|
        target = merged[path] ||= {
          "nodes" => {},
          "edges" => Hash.new { |hash, key| hash[key] = Set.new }
        }
        graph["nodes"].each do |token, node|
          current = target["nodes"][token]
          if current
            source_session_ids =
              (Array(current["source_session_ids"]) | Array(node["source_session_ids"])).sort
            observed_before =
              current["observed_before"] == true || node["observed_before"] == true
            observed_after =
              current["observed_after"] == true || node["observed_after"] == true
            selected = node["rank"].to_f > current["rank"].to_f ? node.dup : current
            selected["source_session_ids"] = source_session_ids
            selected["observed_before"] = observed_before
            selected["observed_after"] = observed_after
            target["nodes"][token] = selected
          else
            target["nodes"][token] = node.dup
          end
        end
        graph["edges"].each do |from, destinations|
          destinations.each { |to| target["edges"][from] << to }
        end
      end
    end

    primary_files = {}
    conflicts = []
    merged.keys.sort.each do |path|
      graph = merged[path]
      nodes = graph["nodes"]
      heads = nodes.keys.select do |token|
        graph["edges"][token].none? { |destination| destination != token && nodes.key?(destination) }
      end
      heads = nodes.keys if heads.empty?
      # A later trace can begin from the exact bytes that were the head of an
      # earlier trace. Its outgoing transition is causal evidence that the
      # earlier head was superseded. Rank guards preserve a genuine later
      # linear revert such as A -> B -> A.
      transitions = nodes.values.select do |source|
        graph["edges"][source["token"]].any? do |destination|
          target = nodes[destination]
          target && target["content_key"] != source["content_key"]
        end
      end
      causal_heads = heads.reject do |token|
        head = nodes[token]
        transitions.any? do |source|
          source["content_key"] == head["content_key"] &&
            source["rank"].to_f > head["rank"].to_f
        end
      end
      heads = causal_heads unless causal_heads.empty?
      head_nodes = heads.map { |token| nodes[token] }
      content_heads = head_nodes.each_with_object({}) do |node, groups|
        content_key = node["content_key"] ||
          (node["state"] == "file" ? "sha:#{node["sha256"]}" : "absent")
        current = groups[content_key]
        if current
          source_session_ids =
            (Array(current["source_session_ids"]) | Array(node["source_session_ids"])).sort
          observed_before =
            current["observed_before"] == true || node["observed_before"] == true
          observed_after =
            current["observed_after"] == true || node["observed_after"] == true
          selected = node["rank"].to_f > current["rank"].to_f ? node.dup : current
          selected["source_session_ids"] = source_session_ids
          selected["observed_before"] = observed_before
          selected["observed_after"] = observed_after
          groups[content_key] = selected
        else
          groups[content_key] = node.dup
        end
      end.values
      after_heads = content_heads.select { |node| node["observed_after"] == true }
      preferred_heads = after_heads.empty? ? content_heads : after_heads
      positive_heads = preferred_heads.select { |node| node["state"] == "file" }
      primary = (positive_heads.empty? ? preferred_heads : positive_heads).max_by do |node|
        [node["rank"].to_f, node["sha256"].to_s, node["token"].to_s]
      end
      primary_files[path] = public_descriptor(primary) if primary && primary["state"] == "file"

      if content_heads.length > 1
        alternates = content_heads.reject { |node| node.equal?(primary) }
        conflicts << {
          "path" => path,
          "primary" => primary,
          "alternate_nodes" => alternates
        }
      end
    end
    { "primary_files" => primary_files, "conflicts" => conflicts }
  end

  def scan_phase(directory, snapshot_root, budget)
    stat = File.lstat(directory) rescue nil
    return nil unless stat
    raise UnsafeSnapshot, "Snapshot phase is a symlink" if stat.symlink?
    raise UnsafeSnapshot, "Snapshot phase is not a directory" unless stat.directory?
    canonical = File.realpath(directory)
    raise UnsafeSnapshot, "Snapshot phase escapes its root" unless within_path?(canonical, snapshot_root)

    result = {}
    %w[purpose.md schema.md].each do |relative_path|
      scan_exact_snapshot_entry(directory, relative_path, snapshot_root, budget, result)
    end
    scan_tree_namespace(directory, "wiki", snapshot_root, budget, result)
    scan_tree_namespace(directory, "raw/sources", snapshot_root, budget, result)
    META_JSON_ALLOWLIST.each do |name|
      scan_exact_snapshot_entry(
        directory, ".llm-wiki/#{name}", snapshot_root, budget, result
      )
    end
    result
  end

  def scan_exact_snapshot_entry(root, relative_path, snapshot_root, budget, result)
    content_path = File.join(root, relative_path)
    absent_path = "#{content_path}#{TOMBSTONE_SUFFIX}"
    content_exists = path_exists?(content_path)
    absent_exists = path_exists?(absent_path)
    if content_exists && absent_exists
      raise UnsafeSnapshot, "Snapshot contains content and tombstone for #{relative_path}"
    end
    if content_exists
      result[relative_path] = snapshot_descriptor(content_path, snapshot_root, budget)
    elsif absent_exists
      snapshot_descriptor(absent_path, snapshot_root, budget)
      result[relative_path] = { "state" => "absent" }
    end
  end

  def scan_tree_namespace(root, relative_root, snapshot_root, budget, result)
    path = File.join(root, relative_root)
    validate_namespace_ancestors!(root, relative_root)
    stat = File.lstat(path) rescue nil
    return unless stat
    raise UnsafeSnapshot, "Allowed snapshot namespace is a symlink" if stat.symlink?
    raise UnsafeSnapshot, "Allowed snapshot namespace is not a directory" unless stat.directory?

    stack = [[path, relative_root]]
    until stack.empty?
      directory, prefix = stack.pop
      Dir.children(directory).sort.reverse.each do |name|
        child = File.join(directory, name)
        relative_path = "#{prefix}/#{name}"
        child_stat = File.lstat(child)
        raise UnsafeSnapshot, "Symlink inside allowed snapshot namespace" if child_stat.symlink?
        if child_stat.directory?
          stack << [child, relative_path]
        elsif child_stat.file?
          target_path = relative_path.end_with?(TOMBSTONE_SUFFIX) ?
            relative_path[0...-TOMBSTONE_SUFFIX.length] : relative_path
          raise UnsafeSnapshot, "Unsafe snapshot path" unless allowed_project_path?(target_path)
          if relative_path.end_with?(TOMBSTONE_SUFFIX)
            snapshot_descriptor(child, snapshot_root, budget)
            raise UnsafeSnapshot, "Duplicate snapshot entry" if result.key?(target_path)
            result[target_path] = { "state" => "absent" }
          else
            raise UnsafeSnapshot, "Duplicate snapshot entry" if result.key?(relative_path)
            result[relative_path] = snapshot_descriptor(child, snapshot_root, budget)
          end
        else
          raise UnsafeSnapshot, "Special file inside allowed snapshot namespace"
        end
      end
    end
  rescue SystemCallError => error
    raise UnsafeSnapshot, "Cannot read allowed snapshot namespace: #{error.message}"
  end

  def validate_namespace_ancestors!(root, relative_root)
    current = root
    parts = relative_root.split("/")
    parts[0...-1].each do |part|
      current = File.join(current, part)
      stat = File.lstat(current) rescue nil
      next unless stat
      raise UnsafeSnapshot, "Allowed snapshot namespace ancestor is a symlink" if stat.symlink?
      raise UnsafeSnapshot, "Allowed snapshot namespace ancestor is not a directory" unless stat.directory?
    end
  end

  def snapshot_descriptor(path, snapshot_root, budget)
    raise UnsafeSnapshot, "Snapshot file escapes its root" unless secure_snapshot_file?(path, snapshot_root)
    stat = File.lstat(path)
    raise UnsafeSnapshot, "Snapshot file is too large" if stat.size > MAX_FILE_BYTES
    budget[:files] += 1
    budget[:bytes] += stat.size
    raise UnsafeSnapshot, "Snapshot has too many files" if budget[:files] > MAX_FILES
    raise UnsafeSnapshot, "Snapshot is too large" if budget[:bytes] > MAX_TOTAL_BYTES

    digest = Digest::SHA256.new
    bytes = 0
    open_snapshot_file(path) do |file|
      while (chunk = file.read(1024 * 1024))
        digest.update(chunk)
        bytes += chunk.bytesize
      end
    end
    raise UnsafeSnapshot, "Snapshot file changed while reading" unless bytes == stat.size
    {
      "state" => "file",
      "source_path" => path,
      "sha256" => digest.hexdigest,
      "size" => stat.size,
      "updated_at" => stat.mtime.iso8601
    }
  rescue SystemCallError => error
    raise UnsafeSnapshot, "Cannot read snapshot file: #{error.message}"
  end

  def live_covers_manifest?(path_hints, content_manifest, snapshot_root, candidate_project_id)
    path_hints.any? do |path|
      next false unless File.directory?(path) && !File.symlink?(path)
      next false if within_path?(path, snapshot_root)
      live_files = scan_live_project(path)
      next false unless live_files
      live_meta = descriptor_json(live_files[".llm-wiki/project-meta.json"])
      live_project_id = normalized_project_id(live_meta["project_id"])
      # An explicit project ID is an incarnation boundary. Exact bytes at a
      # reused path cannot make two differently identified projects the same.
      if candidate_project_id || live_project_id
        next false unless candidate_project_id && live_project_id &&
          secure_equal?(candidate_project_id, live_project_id)
      end
      content_manifest.all? do |relative_path, sha|
        descriptor = live_files[relative_path]
        descriptor && secure_equal?(descriptor["sha256"], sha)
      end
    end
  end

  def scan_live_project(path)
    root = canonical_existing_directory(path)
    return nil unless root
    budget = { files: 0, bytes: 0 }
    files = {}
    %w[purpose.md schema.md].each do |relative_path|
      live_exact_entry(root, relative_path, budget, files)
    end
    live_tree_namespace(root, "wiki", budget, files)
    live_tree_namespace(root, "raw/sources", budget, files)
    META_JSON_ALLOWLIST.each do |name|
      live_exact_entry(root, ".llm-wiki/#{name}", budget, files)
    end
    reconstructable_wiki?(files) ? files : nil
  rescue UnsafeSnapshot, SystemCallError
    nil
  end

  def live_exact_entry(root, relative_path, budget, result)
    path = File.join(root, relative_path)
    return unless path_exists?(path)
    result[relative_path] = live_descriptor(path, root, budget)
  end

  def live_tree_namespace(root, relative_root, budget, result)
    path = File.join(root, relative_root)
    validate_namespace_ancestors!(root, relative_root)
    stat = File.lstat(path) rescue nil
    return unless stat
    raise UnsafeSnapshot, "Live project namespace is a symlink" if stat.symlink?
    raise UnsafeSnapshot, "Live project namespace is not a directory" unless stat.directory?
    stack = [[path, relative_root]]
    until stack.empty?
      directory, prefix = stack.pop
      Dir.children(directory).each do |name|
        child = File.join(directory, name)
        relative_path = "#{prefix}/#{name}"
        child_stat = File.lstat(child)
        raise UnsafeSnapshot, "Live project contains a symlink" if child_stat.symlink?
        if child_stat.directory?
          stack << [child, relative_path]
        elsif child_stat.file?
          result[relative_path] = live_descriptor(child, root, budget)
        else
          raise UnsafeSnapshot, "Live project contains a special file"
        end
      end
    end
  end

  def live_descriptor(path, root, budget)
    stat = File.lstat(path)
    raise UnsafeSnapshot, "Live project file is not regular" unless stat.file? && !stat.symlink?
    canonical = File.realpath(path)
    raise UnsafeSnapshot, "Live project file escapes its root" unless within_path?(canonical, root)
    raise UnsafeSnapshot, "Live project file is too large" if stat.size > MAX_FILE_BYTES
    budget[:files] += 1
    budget[:bytes] += stat.size
    raise UnsafeSnapshot, "Live project has too many files" if budget[:files] > MAX_FILES
    raise UnsafeSnapshot, "Live project is too large" if budget[:bytes] > MAX_TOTAL_BYTES
    {
      "state" => "file",
      "source_path" => path,
      "sha256" => Digest::SHA256.file(path).hexdigest,
      "size" => stat.size,
      "updated_at" => stat.mtime.iso8601
    }
  end

  def reconstructable_wiki?(files)
    purpose = files["purpose.md"]
    schema = files["schema.md"]
    return false unless nonempty_descriptor?(purpose) && nonempty_descriptor?(schema)
    files.keys.any? { |path| knowledge_page?(path) }
  end

  def nonempty_descriptor?(descriptor)
    return false unless descriptor.is_a?(Hash) && descriptor["state"] == "file"
    return false if descriptor["size"].to_i <= 0
    !descriptor_text(descriptor, 1024 * 1024).strip.empty?
  end

  def knowledge_page?(path)
    value = path.to_s
    value.start_with?("wiki/") &&
      value.downcase.end_with?(".md") &&
      !ROOT_STARTER_PAGES.include?(value.downcase) &&
      !value.start_with?("wiki/recovered-conflicts/")
  end

  def wiki_markdown_page?(path)
    value = path.to_s
    value.start_with?("wiki/") && value.downcase.end_with?(".md")
  end

  def allowed_project_path?(path)
    value = path.to_s
    return false unless safe_relative_path?(value)
    return true if value == "purpose.md" || value == "schema.md"
    return true if value.start_with?("wiki/") && value.length > "wiki/".length
    return true if value.start_with?("raw/sources/") && value.length > "raw/sources/".length
    if value.start_with?(".llm-wiki/")
      return META_JSON_ALLOWLIST.include?(value.sub(".llm-wiki/", ""))
    end
    false
  end

  def descriptor_json(descriptor)
    return {} unless descriptor.is_a?(Hash) && descriptor["state"] == "file"
    value = JSON.parse(descriptor_text(descriptor, 1024 * 1024))
    value.is_a?(Hash) ? value : {}
  rescue JSON::ParserError
    {}
  end

  def descriptor_text(descriptor, limit)
    return "" unless descriptor.is_a?(Hash)
    return "" if descriptor["size"].to_i > limit
    File.read(descriptor["source_path"], encoding: "utf-8")
  rescue EncodingError, SystemCallError
    ""
  end

  def public_descriptor(node)
    {
      "state" => "file",
      "source_path" => node["source_path"],
      "sha256" => node["sha256"],
      "size" => node["size"].to_i,
      "updated_at" => node["updated_at"],
      "source_session_ids" => Array(node["source_session_ids"]).sort
    }
  end

  def conflict_storage_path(original_path, sha, occupied)
    raw_extension = File.extname(original_path)
    extension = raw_extension.match?(/\A\.[A-Za-z0-9]{1,12}\z/) ? raw_extension.downcase : ".bin"
    raw_stem = File.basename(original_path, raw_extension).gsub(/[^A-Za-z0-9._-]+/, "-")
    raw_stem = raw_stem.gsub(/\A[-.]+|[-.]+\z/, "")
    raw_stem = "file" if raw_stem.empty?
    stem = raw_stem.byteslice(0, 48).to_s.gsub(/[-.]+\z/, "")
    path_digest = Digest::SHA256.hexdigest(original_path.to_s)[0, 12]
    candidate = "wiki/recovered-conflicts/#{stem}-#{path_digest}-#{sha.to_s[0, 12]}#{extension}"
    suffix = 1
    while occupied.include?(candidate)
      candidate = "wiki/recovered-conflicts/#{stem}-#{path_digest}-#{sha.to_s[0, 12]}-#{suffix}#{extension}"
      suffix += 1
    end
    occupied << candidate
    candidate
  end

  def validate_virtual_paths!(files)
    folded = {}
    paths = files.keys.map(&:to_s).sort
    paths.each do |path|
      raise UnsafeSnapshot, "Recovery contains an unsafe path" unless allowed_project_path?(path)
      key = path.downcase
      raise UnsafeSnapshot, "Recovery contains a case-colliding path" if folded.key?(key)
      folded[key] = true
    end
    folded_paths = folded.keys.to_set
    folded_paths.each do |path|
      parts = path.split("/")
      (1...parts.length).each do |length|
        ancestor = parts.first(length).join("/")
        next unless folded_paths.include?(ancestor)
        raise UnsafeSnapshot, "Recovery contains a file/directory path collision"
      end
    end
    true
  end

  def content_manifest_for(files)
    files.each_with_object({}) do |(path, descriptor), result|
      next if path == ".llm-wiki/project-meta.json" || path == ActivityLog::FILE
      result[path] = descriptor["sha256"]
    end
  end

  def incarnation_id_for(project_id, component)
    return "project:#{project_id}" if project_id
    earliest = component.min_by do |observation|
      [
        sort_time(observation["created_at"]),
        observation["observation_id"] || observation["session_id"]
      ]
    end
    # Identical content can exist in independent legacy epochs. The earliest
    # stable session epoch keeps those incarnations distinct. Anchors are
    # intentionally excluded because later snapshots can add evidence for a
    # page that was subsequently deleted without changing the final project.
    seed = JSON.generate(
      "observation_id" => earliest["observation_id"] || earliest["session_id"],
      "created_at" => earliest["created_at"]
    )
    "content:#{Digest::SHA256.hexdigest(seed)[0, 32]}"
  end

  def recovery_id_for(incarnation_id, content_manifest_id)
    digest = Digest::SHA256.hexdigest(
      "llm-wiki-recovery-v2\0#{incarnation_id}\0#{content_manifest_id}"
    )
    "legacy-#{digest[0, 24]}"
  end

  def recovered_directory_name(recovery_id)
    "wiki-recovered-#{recovery_id.to_s.sub(/\Alegacy-/, "")}"
  end

  def candidate_name(meta, files, path_hint)
    name = meta["name"].to_s.strip
    return name unless name.empty?
    purpose = descriptor_text(files["purpose.md"], 256 * 1024)
    heading = purpose.match(/^#\s+(.+?)\s*$/)
    return heading[1].strip if heading && !heading[1].to_s.strip.empty?
    fallback_name(path_hint)
  end

  def fallback_name(path_hint)
    basename = File.basename(path_hint.to_s).tr("_-", " ").strip
    basename.empty? ? "Recovered Knowledge Base" : basename
  end

  def normalized_virtual_files(value)
    raise InvalidCandidate, "Invalid recovery manifest" unless value.is_a?(Hash)
    result = value.each_with_object({}) do |(relative_path, descriptor), files|
      path = relative_path.to_s
      raise InvalidCandidate, "Unsafe recovery path" unless allowed_project_path?(path)
      raise InvalidCandidate, "Invalid recovery descriptor" unless descriptor.is_a?(Hash)
      normalized = stringify_hash(descriptor)
      unless normalized["state"].to_s == "file" &&
          normalized["sha256"].to_s.match?(/\A[0-9a-f]{64}\z/) &&
          normalized["size"].to_i >= 0
        raise InvalidCandidate, "Invalid recovery checksum"
      end
      files[path] = normalized
    end
    validate_virtual_paths!(result)
    result
  rescue UnsafeSnapshot => error
    raise InvalidCandidate, error.message
  end

  def recover_interrupted_install!(final_path, candidate)
    return unless path_exists?(final_path)
    stat = File.lstat(final_path) rescue nil
    return unless stat && stat.directory? && !stat.symlink?

    marker_path = File.join(final_path, INSTALL_MARKER)
    if valid_receipt?(
      project_path: final_path,
      recovery_id: candidate["recovery_id"],
      candidate: candidate
    )
      File.delete(marker_path) if valid_install_marker?(final_path, candidate)
      return
    end

    # Never infer ownership from an empty or merely incomplete-looking
    # directory. Only an exact module marker authorizes recursive cleanup.
    FileUtils.rm_rf(final_path) if valid_install_marker?(final_path, candidate)
  rescue SystemCallError
    nil
  end

  def write_install_marker!(final_path, candidate)
    marker = install_marker(candidate, File.basename(final_path))
    path = File.join(final_path, INSTALL_MARKER)
    File.open(path, File::WRONLY | File::CREAT | File::EXCL, 0o600) do |file|
      file.write(JSON.generate(marker))
      file.flush
      file.fsync rescue nil
    end
  rescue Errno::EEXIST
    raise DestinationExists, "Recovery install marker already exists"
  end

  def valid_install_marker?(final_path, candidate)
    path = File.join(final_path, INSTALL_MARKER)
    stat = File.lstat(path) rescue nil
    return false unless stat && stat.file? && !stat.symlink? && stat.size <= 16 * 1024
    marker = JSON.parse(File.read(path, encoding: "utf-8"))
    expected = install_marker(candidate, File.basename(final_path))
    marker.is_a?(Hash) &&
      expected.all? { |key, value| secure_equal?(marker[key].to_s, value.to_s) }
  rescue EncodingError, JSON::ParserError, SystemCallError
    false
  end

  def install_marker(candidate, destination_name)
    payload = {
      "version" => RECOVERY_VERSION,
      "recovery_id" => candidate["recovery_id"].to_s,
      "content_manifest_id" => candidate["content_manifest_id"].to_s,
      "incarnation_id" => candidate["incarnation_id"].to_s,
      "destination_name" => destination_name.to_s
    }
    payload["signature"] = Digest::SHA256.hexdigest(
      "llm-wiki-recovery-install-v2\0#{JSON.generate(payload)}"
    )
    payload
  end

  def install_temporary_project!(temporary_path, final_path)
    entries = Dir.children(temporary_path)
    raise InvalidCandidate, "Recovered project metadata is missing" unless entries.include?(".llm-wiki")

    (entries - [".llm-wiki"]).sort.each do |entry|
      destination = File.join(final_path, entry)
      raise DestinationExists, "Recovery destination entry already exists" if path_exists?(destination)
      File.rename(File.join(temporary_path, entry), destination)
    end
    metadata_destination = File.join(final_path, ".llm-wiki")
    raise DestinationExists, "Recovery metadata destination already exists" if path_exists?(metadata_destination)
    File.rename(File.join(temporary_path, ".llm-wiki"), metadata_destination)
  end

  def enforce_resolved_limits!(files)
    raise UnsafeSnapshot, "Recovery has too many files" if files.length > MAX_FILES
    total = 0
    files.each_value do |descriptor|
      size = descriptor["size"].to_i
      raise UnsafeSnapshot, "Recovery file is too large" if size > MAX_FILE_BYTES
      total += size
      raise UnsafeSnapshot, "Recovery is too large" if total > MAX_TOTAL_BYTES
    end
  end

  def immutable_files(files)
    files.reject do |path, _descriptor|
      path == ".llm-wiki/project-meta.json" || path == ActivityLog::FILE
    end
  end

  def copy_verified_file(descriptor:, relative_path:, destination_path:, snapshot_root:)
    source_path = descriptor["source_path"].to_s
    raise InvalidCandidate, "Snapshot file is unavailable" unless secure_snapshot_file?(source_path, snapshot_root)
    expected_size = descriptor["size"].to_i
    expected_sha = descriptor["sha256"].to_s
    FileUtils.mkdir_p(File.dirname(destination_path))
    digest = Digest::SHA256.new
    bytes = 0
    open_snapshot_file(source_path) do |source|
      File.open(destination_path, File::WRONLY | File::CREAT | File::EXCL, 0o600) do |destination|
        # Snapshot payloads are opaque bytes. Explicit binary mode prevents
        # Rack/server process encoding defaults from transcoding UTF-8 content
        # (for example a Chinese page beginning with byte 0xE7) while copying.
        destination.binmode
        while (chunk = source.read(1024 * 1024))
          destination.write(chunk)
          digest.update(chunk)
          bytes += chunk.bytesize
        end
        destination.flush
        destination.fsync rescue nil
      end
    end
    unless bytes == expected_size && secure_equal?(digest.hexdigest, expected_sha)
      raise InvalidCandidate, "Snapshot checksum changed for #{relative_path}"
    end
  rescue Errno::EEXIST
    raise InvalidCandidate, "Duplicate recovery path"
  end

  def verify_recovered_files!(root, files)
    files.each do |relative_path, descriptor|
      path = File.join(root, relative_path)
      stat = File.lstat(path) rescue nil
      unless stat && stat.file? && !stat.symlink? &&
          stat.size == descriptor["size"].to_i &&
          secure_equal?(Digest::SHA256.file(path).hexdigest, descriptor["sha256"].to_s)
        raise InvalidCandidate, "Restored checksum mismatch for #{relative_path}"
      end
    end
  end

  def project_file_sha256(project_path)
    root = canonical_existing_directory(project_path)
    raise InvalidReceipt, "Project directory is unavailable" unless root
    budget = { files: 0, bytes: 0 }
    files = scan_live_project(root)
    raise InvalidReceipt, "Recovered project is incomplete" unless files
    files.delete(".llm-wiki/recovery.json")
    files.each_with_object({}) do |(path, descriptor), result|
      result[path] = descriptor["sha256"]
    end
  end

  def write_recovery_metadata(project_path, candidate, file_sha256)
    metadata = {
      "version" => RECOVERY_VERSION,
      "recovery_id" => candidate["recovery_id"],
      "content_manifest_id" => candidate["content_manifest_id"],
      "incarnation_id" => candidate["incarnation_id"],
      "incarnation_aliases" => Array(candidate["incarnation_aliases"]),
      "session_id" => candidate["session_id"],
      "source_session_ids" => Array(candidate["source_session_ids"]),
      "original_path" => candidate["original_path"],
      "original_paths" => Array(candidate["original_paths"]),
      "recovered_at" => Time.now.iso8601,
      "page_count" => candidate["page_count"].to_i,
      "source_count" => candidate["source_count"].to_i,
      "conflicts" => Array(candidate["conflicts"]),
      "file_sha256" => file_sha256
    }
    metadata["receipt_signature"] = receipt_signature(metadata)
    Storage.atomic_write(
      File.join(project_path, ".llm-wiki", "recovery.json"),
      JSON.pretty_generate(metadata),
      encoding: "utf-8"
    )
  end

  def verify_hash_manifest!(project_path, expected_hashes)
    current = project_file_sha256(project_path)
    unless current.keys.sort == expected_hashes.keys.sort
      raise InvalidCandidate, "Recovered file set changed before sealing"
    end
    expected_hashes.each do |path, sha|
      unless secure_equal?(sha.to_s, current[path].to_s)
        raise InvalidCandidate, "Recovered checksum changed before sealing for #{path}"
      end
    end
  end

  def receipt_signature(receipt)
    payload = stringify_hash(receipt).reject { |key, _value| key == "receipt_signature" }
    Digest::SHA256.hexdigest(
      "llm-wiki-recovery-receipt-v2\0#{JSON.generate(canonical_json_value(payload))}"
    )
  end

  def canonical_json_value(value)
    if value.is_a?(Hash)
      value.keys.map(&:to_s).sort.each_with_object({}) do |key, result|
        source_key = value.key?(key) ? key : key.to_sym
        result[key] = canonical_json_value(value[source_key])
      end
    elsif value.is_a?(Array)
      value.map { |item| canonical_json_value(item) }
    else
      value
    end
  end

  def exact_recovery_ids(values)
    Array(values).each_with_object(Set.new) do |value, result|
      item = if value.is_a?(Hash)
        value["recovery_id"] || value[:recovery_id]
      else
        value
      end
      text = item.to_s
      result << text if text.match?(/\Alegacy-[0-9a-f]{24}\z/)
    end
  end

  def validate_candidate_signature!(candidate)
    supplied = candidate["_integrity"].to_s
    unless supplied.match?(/\A[0-9a-f]{64}\z/) &&
        secure_equal?(supplied, candidate_signature(candidate))
      raise InvalidCandidate, "Recovery candidate integrity check failed"
    end
  end

  def candidate_signature(candidate)
    files = candidate["virtual_files"]
    manifest = if files.is_a?(Hash)
      files.keys.map(&:to_s).sort.map do |path|
        descriptor = stringify_hash(files[path] || files[path.to_sym])
        [path, descriptor["source_path"], descriptor["sha256"], descriptor["size"].to_i]
      end
    else
      []
    end
    payload = [
      candidate["recovery_id"],
      candidate["content_manifest_id"],
      candidate["incarnation_id"],
      candidate["project_id"],
      Array(candidate["source_session_ids"]).sort,
      Array(candidate["original_paths"]).sort,
      Array(candidate["conflicts"]),
      candidate["_snapshot_root"],
      manifest
    ]
    Digest::SHA256.hexdigest("#{integrity_secret}\0#{JSON.generate(payload)}")
  end

  def normalized_project_id(value)
    text = value.to_s.strip
    return nil if text.empty? || text.bytesize > 200 || !text.valid_encoding?
    text
  end

  def normalized_session_id(value)
    text = value.to_s.strip
    return nil if text.empty? || text == "." || text == ".."
    text.match?(/\A[A-Za-z0-9][A-Za-z0-9._-]*\z/) ? text : nil
  end

  def normalized_path_hint(value, snapshot_root)
    text = value.to_s.strip
    return nil if text.empty? || text.include?("\0") || !absolute_path?(text)
    expanded = File.expand_path(text)
    within_path?(expanded, snapshot_root) ? nil : expanded
  rescue ArgumentError
    nil
  end

  def normalized_time(value)
    text = value.to_s.strip
    return nil if text.empty?
    Time.iso8601(text).iso8601
  rescue ArgumentError
    nil
  end

  def sort_time(value)
    Time.iso8601(value.to_s).to_f
  rescue ArgumentError
    0.0
  end

  def integer_value(value)
    Integer(value)
  rescue ArgumentError, TypeError
    nil
  end

  def safe_relative_path?(path)
    value = path.to_s
    return false if value.empty? || value.bytesize > 4096 || !value.valid_encoding?
    return false if value.start_with?("/", "\\") || value.include?("\\") || value.include?("\0")
    value.split("/", -1).all? do |part|
      !part.empty? && part != "." && part != ".." && part.bytesize <= 255
    end
  end

  def safe_root(path)
    expanded = File.expand_path(path.to_s)
    stat = File.lstat(expanded) rescue nil
    return nil unless stat && stat.directory? && !stat.symlink?
    File.realpath(expanded)
  rescue ArgumentError, SystemCallError
    nil
  end

  def canonical_existing_directory(path)
    safe_root(path)
  end

  def safe_snapshot_directory(snapshot_root, session_id)
    path = File.join(snapshot_root, session_id)
    stat = File.lstat(path) rescue nil
    return nil unless stat && stat.directory? && !stat.symlink?
    canonical = File.realpath(path)
    within_path?(canonical, snapshot_root) ? canonical : nil
  rescue SystemCallError
    nil
  end

  def secure_snapshot_file?(path, snapshot_root)
    expanded = File.expand_path(path.to_s)
    return false unless within_path?(expanded, snapshot_root)
    stat = File.lstat(expanded) rescue nil
    return false unless stat && stat.file? && !stat.symlink?
    return false if symlink_component?(expanded, snapshot_root)
    within_path?(File.realpath(expanded), snapshot_root)
  rescue ArgumentError, SystemCallError
    false
  end

  def symlink_component?(path, root)
    relative = path.sub(/\A#{Regexp.escape(root)}\/?/, "")
    current = root
    relative.split("/").any? do |part|
      current = File.join(current, part)
      File.lstat(current).symlink?
    rescue SystemCallError
      true
    end
  end

  def open_snapshot_file(path)
    flags = File::RDONLY
    flags |= File::NOFOLLOW if File.const_defined?(:NOFOLLOW)
    File.open(path, flags) do |file|
      file.binmode
      yield(file)
    end
  end

  def each_regular_json(root)
    Dir.children(root).select { |entry| entry.end_with?(".json") }.sort.each do |entry|
      path = File.join(root, entry)
      stat = File.lstat(path) rescue nil
      next unless stat && stat.file? && !stat.symlink?
      yield(path)
    end
  rescue SystemCallError
    nil
  end

  def read_json_file(path)
    stat = File.lstat(path)
    return nil unless stat.file? && !stat.symlink? && stat.size <= MAX_FILE_BYTES
    JSON.parse(File.read(path, encoding: "utf-8"))
  rescue EncodingError, JSON::ParserError, SystemCallError
    nil
  end

  def absolute_path?(path)
    path.start_with?("/") || path.match?(/\A[A-Za-z]:[\\\/]/)
  end

  def path_exists?(path)
    File.exist?(path) || File.symlink?(path)
  end

  def within_path?(path, root)
    expanded_path = File.expand_path(path.to_s)
    expanded_root = File.expand_path(root.to_s)
    expanded_path == expanded_root ||
      expanded_path.start_with?("#{expanded_root}#{File::SEPARATOR}")
  end

  def prepare_destination_root(path)
    expanded = File.expand_path(path.to_s)
    raise InvalidCandidate, "Destination root is required" if path.to_s.strip.empty?
    raise InvalidCandidate, "Destination root cannot be a symlink" if File.symlink?(expanded)
    FileUtils.mkdir_p(expanded)
    root = canonical_existing_directory(expanded)
    raise InvalidCandidate, "Destination root is unavailable" unless root
    root
  rescue ArgumentError, SystemCallError => error
    raise InvalidCandidate, "Destination root is unavailable: #{error.message}"
  end

  def ensure_direct_child!(path, root)
    unless File.dirname(File.expand_path(path)) == File.expand_path(root)
      raise InvalidCandidate, "Recovery destination escapes its managed root"
    end
  end

  def secure_equal?(left, right)
    left_value = left.to_s
    right_value = right.to_s
    return false unless left_value.bytesize == right_value.bytesize
    difference = 0
    left_value.bytes.zip(right_value.bytes) { |a, b| difference |= a ^ b }
    difference.zero?
  end

  def stringify_hash(value)
    return {} unless value.is_a?(Hash)
    value.each_with_object({}) { |(key, item), result| result[key.to_s] = item }
  end

  def deep_copy(value)
    Marshal.load(Marshal.dump(value))
  end

  def cache_mutex
    @cache_mutex ||= Mutex.new
  end

  def integrity_secret
    @integrity_secret ||= SecureRandom.hex(32)
  end
end

# LLM Wiki local Codex companion. No model calls and no OpenClacky runtime.
require 'webrick'
require 'json'
require 'securerandom'
require 'fileutils'
require 'digest'
require 'uri'
require 'optparse'

module Clacky
  module Logger
    def self.warn(message); $stderr.puts(message); end
    def self.error(message); $stderr.puts(message); end
  end
  class ApiExtension
    class Halt < StandardError
      attr_reader :status, :body, :content_type, :extra_headers
      def initialize(status, body, content_type='application/json', extra_headers: {})
        @status, @body, @content_type, @extra_headers = status, body, content_type, extra_headers
      end
    end
    class << self
      def routes; @routes ||= {}; end
      %w[get post put delete].each do |verb|
        define_method(verb) { |path, **options, &block| routes[[verb.upcase, path]] = block }
      end
    end
    attr_reader :req
    def initialize(req, data); @req, @data = req, data; end
    def query; @query ||= URI.decode_www_form(req.query_string.to_s, Encoding::UTF_8).to_h; end
    def json_body; @body ||= req.body.to_s.empty? ? {} : JSON.parse(req.body); end
    def json(value); raise Halt.new(200, JSON.generate(value)); end
    def error!(message, status: 400); raise Halt.new(status, JSON.generate(error: message)); end
  end
end
WORKSPACE = File.expand_path('../assets/workspace', __dir__)
require File.join(WORKSPACE, 'api/handler')

class LlmWikiHandler
  # Only deterministic routes below are served. Upstream model/session routes
  # remain source history, never callable through this runtime.
  ALLOWED = %w[/status /projects /global-project /wiki/tree /wiki/page /wiki/page/metadata /wiki/page/move /wiki/asset /wiki/index /wiki/schema /wiki/purpose /sidebar/order /sidebar/reorder /sidebar/move /sources /sources/upload /sources/clip /graph /graph/config /graph/config/type /graph/related /graph/communities /graph/insights /search /lint /review /review/resolve /activity /settings /research/tasks].freeze
  def ext_data_dir; @data; end
  def request_session_id; ''; end
  def project_scope; current_project_path ? 'explicit' : 'none'; end
  def trusted_local_origin?; true; end # enforced by server before dispatch
  def bind_session_to_project(path); remember_project(path); touch_project_access(path); end
  def require_project!
    error!('Choose an opened knowledge base in the Codex workspace first.', status: 400) unless current_project_path && Dir.exist?(current_project_path)
  end
  def current_project_path
    return @resolved_project_path if defined?(@resolved_project_path)
    path = request_project_path
    path = selected_global_project_path if path.empty? && GlobalProjectSelection.enabled?(ext_data_dir)
    return nil if path.to_s.empty?
    expanded = File.expand_path(path)
    error!('Open this knowledge base before accessing it', status: 403) unless registered_paths.include?(expanded)
    reject_links!(expanded)
    @resolved_project_path = expanded
  end
  def registered_paths
    (Dir.glob(File.join(projects_root, '*')) + remembered_project_paths).map { |p| File.expand_path(p) }.uniq.select { |p| wiki_project?(p) }
  end
  def reject_links!(path)
    p = File.expand_path(path)
    loop do
      error!('Symbolic links are not allowed', status: 400) if File.symlink?(p)
      parent = File.dirname(p); break if parent == p; p = parent
    end
    if Dir.exist?(path)
      Find.find(path) do |entry|
        error!('Symbolic links are not allowed', status: 400) if File.symlink?(entry)
        Find.prune if File.directory?(entry) && %w[node_modules .git].include?(File.basename(entry))
      end
    end
  end
  def recovery_config
    path = File.join(ext_data_dir, 'recovery-sources.json')
    File.exist?(path) ? JSON.parse(File.read(path)) : {}
  end
  def sessions_root; recovery_config['sessions_root'] || File.join(ext_data_dir, 'unconfigured-sessions'); end
  def snapshots_root; recovery_config['snapshots_root'] || File.join(ext_data_dir, 'unconfigured-snapshots'); end
  def project_trash_rows
    root = File.join(ext_data_dir, 'project-trash')
    Dir.glob(File.join(root, 'trash-*')).map do |path|
      receipt = File.join(path, '.llm-wiki/project-trash.json')
      next unless File.file?(receipt)
      data = JSON.parse(File.read(receipt))
      project_info_for(path).merge('path'=>path, 'original_path'=>data['original_path'], 'original_paths'=>[data['original_path']], 'recoverable'=>true, 'recovery_id'=>File.basename(path), 'managed'=>false, 'trashed'=>true)
    end.compact
  end
  def list_projects
    FileUtils.mkdir_p(projects_root)
    selected = selected_global_project_path
    registered_paths.map { |p| project_info_for(p).merge('managed'=>managed_project_path?(p), 'global_selected'=> p == selected, 'global_enabled'=>GlobalProjectSelection.enabled?(ext_data_dir)) } + recoverable_project_rows + project_trash_rows
  end
  def dispatch(path)
    if path == '/wiki/asset-chunk' && req.request_method == 'GET'
      require_project!
      full = safe_wiki_asset_path(query.fetch('path'), current_project_path)
      error!('Attachment not found', status: 404) unless File.file?(full)
      mime = WIKI_ASSET_TYPES[File.extname(full).downcase]
      error!('Unsupported attachment type', status: 415) unless mime
      offset = Integer(query.fetch('offset', '0'))
      total = File.size(full)
      error!('Attachment is larger than 25 MB', status: 413) if total > MAX_WIKI_ASSET_BYTES
      error!('Invalid attachment offset', status: 400) unless offset >= 0 && offset <= total
      chunk = File.open(full, 'rb') { |file| file.seek(offset); file.read(512 * 1024) || ''.b }
      json(mimeType: mime, base64: Base64.strict_encode64(chunk), offset: offset, total: total, nextOffset: offset + chunk.bytesize)
    end
    if path == '/wiki/asset' && !query['project'].to_s.empty?
      explicit = File.expand_path(query['project'])
      error!('Open this knowledge base before accessing it', status: 403) unless registered_paths.include?(explicit)
      reject_links!(explicit)
      selected = request_project_path
      error!('Attachment project does not match the selected knowledge base', status: 403) unless selected.empty? || File.expand_path(selected) == explicit
    end
    if path == '/folders' && req.request_method == 'GET'
      input = query.fetch('path').to_s.strip
      error!('Choose a directory first', status: 400) if input.empty?
      directory = File.expand_path(input)
      error!('Directory does not exist', status: 404) unless Dir.exist?(directory)
      error!('Symbolic links are not allowed', status: 400) if File.symlink?(directory)
      folders = Dir.children(directory).reject { |name| name.start_with?('.') }.sort.filter { |name| File.directory?(File.join(directory, name)) && !File.symlink?(File.join(directory, name)) }.map { |name| {name: name, path: File.join(directory, name)} }
      json(path: directory, parent: File.dirname(directory), folders: folders)
    end
    if path == '/projects' && req.request_method == 'DELETE'
      original = File.expand_path(json_body.fetch('path'));reject_links!(original)
      error!('Only managed projects can be deleted', status: 403) unless managed_project_roots.include?(File.dirname(original)) && registered_paths.include?(original)
      id = "trash-#{SecureRandom.hex(12)}"
      destination = File.join(ext_data_dir, 'project-trash', id)
      FileUtils.mkdir_p(File.dirname(destination), mode: 0700)
      Storage.atomic_write(File.join(original, '.llm-wiki/project-trash.json'), JSON.generate(original_path: original, deleted_at: Time.now.utc.iso8601))
      File.rename(original, destination)
      GlobalProjectSelection.clear_project(ext_data_dir, original);forget_project(original)
      json(ok: true, recovery_id: id, recoverable: true)
    end
    if path == '/projects/recover' && req.request_method == 'POST' && json_body['recovery_id'].to_s.start_with?('trash-')
      id = json_body['recovery_id'];error!('Invalid recovery ID', status: 400) unless id.match?(/\Atrash-[0-9a-f]{24}\z/)
      source = File.join(ext_data_dir, 'project-trash', id);reject_links!(source)
      error!('Trash entry not found', status: 404) unless Dir.exist?(source)
      receipt = File.join(source, '.llm-wiki/project-trash.json')
      original = File.expand_path(JSON.parse(File.read(receipt)).fetch('original_path'))
      error!('Invalid restore destination', status: 400) unless managed_project_roots.include?(File.dirname(original))
      error!('Restore destination already exists', status: 409) if File.exist?(original)
      File.rename(source, original);File.delete(File.join(original, '.llm-wiki/project-trash.json'))
      remember_project(original);touch_project_access(original)
      json(ok: true, project: project_info_for(original))
    end
    if path == '/recovery/config' && req.request_method == 'POST'
      config = %w[sessions_root snapshots_root].to_h do |key|
        value = File.expand_path(json_body.fetch(key)); reject_links!(value)
        error!('Recovery source directory does not exist', status: 400) unless Dir.exist?(value)
        [key, value]
      end
      Storage.atomic_write(File.join(ext_data_dir, 'recovery-sources.json'), JSON.generate(config))
      LegacyProjectRecovery.clear_cache!
      json(ok: true, candidates: recoverable_project_rows)
    end
    if path == '/projects/recover' && req.request_method == 'POST'
      id = json_body.fetch('recovery_id')
      error!('Invalid recovery ID', status: 400) unless id.match?(/\Alegacy-[0-9a-f]{24}\z/)
      project = nil
      LegacyProjectRecovery.recovery_lock(destination_root: projects_root) do
        candidate = legacy_recovery_candidates(recovered_ids: []).find { |item| item['recovery_id'] == id }
        project = recovered_project_for_id(id, candidate: candidate)
        unless project
          error!('Historical knowledge base is no longer recoverable', status: 404) unless candidate
          project = LegacyProjectRecovery.restore(candidate: candidate, destination_root: projects_root)
          LegacyProjectRecovery.validate_receipt!(project_path: project['path'], recovery_id: id, candidate: candidate)
        end
      end
      remember_project(project['path']);touch_project_access(project['path'])
      json(ok: true, project: project_info_for(project['path']))
    end
    if path == '/memory/status' && req.request_method == 'GET'
      require_project!
      file = File.join(current_project_path, '.llm-wiki/session-memory.json')
      json(link: File.exist?(file) ? JSON.parse(File.read(file)) : nil)
    end
    if (path == '/ingest/status' && req.request_method == 'GET') || (path == '/ingest/complete' && req.request_method == 'POST')
      error!('An explicit knowledge base is required for ingestion', status: 400) if request_project_path.empty?
      require_project!
      body = req.request_method == 'GET' ? query : json_body
      error!('Invalid ingestion request', status: 400) unless body.is_a?(Hash)
      source = body['source_path']
      error!('source_path must be a nonempty relative path of at most 1024 characters', status: 400) unless source.is_a?(String) && (1..1024).cover?(source.length)
      source_full = safe_source_path(source)
      begin
        if req.request_method == 'GET'
          json(Ingest.source_status(current_project_path, source, source_full))
        else
          error!('Invalid ingestion completion fields', status: 400) unless (body.keys - %w[source_path source_sha256 files]).empty?
          error!('source_sha256 must be a SHA-256 digest', status: 400) unless body['source_sha256'].is_a?(String) && body['source_sha256'].match?(/\A[0-9a-f]{64}\z/)
          files = body['files']
          error!('files must contain 1 to 200 relative wiki page paths', status: 400) unless files.is_a?(Array) && (1..200).cover?(files.length) && files.all? { |file| file.is_a?(String) && (1..1024).cover?(file.length) }
          json(Ingest.record_completion(current_project_path, source, source_full, source_sha256: body['source_sha256'], files: files))
        end
      rescue Ingest::SourceChanged => error
        error!(error.message, status: 409)
      rescue ArgumentError => error
        error!(error.message, status: 400)
      end
    end
    if path == '/review/items' && req.request_method == 'POST'
      error!('An explicit knowledge base is required for review items', status: 400) if request_project_path.empty?
      require_project!
      body = json_body
      error!('Expected an items array only', status: 400) unless body.is_a?(Hash) && body.keys == ['items'] && body['items'].is_a?(Array)
      error!('Submit between 1 and 50 review items', status: 400) unless (1..50).cover?(body['items'].length)
      items = body['items'].map do |item|
        error!('Invalid review item fields', status: 400) unless item.is_a?(Hash) && (item.keys - %w[title detail type source]).empty?
        normalized = {}
        { 'title'=>240, 'detail'=>8000 }.each do |key, limit|
          value = item[key]
          error!("#{key} must be nonempty text of at most #{limit} characters", status: 400) unless value.is_a?(String) && (1..limit).cover?(value.strip.length) && !value.match?(/[\x00-\x08\x0b\x0c\x0e-\x1f]/)
          normalized[key] = value.strip
        end
        normalized['type'] = item.fetch('type', 'research')
        error!('Review type must be research, verify, or expand', status: 400) unless %w[research verify expand].include?(normalized['type'])
        source = item.fetch('source', '')
        error!('Review source must be a relative path of at most 1024 characters', status: 400) unless source.is_a?(String) && source.length <= 1024
        normalized['source'] = source.strip
        unless normalized['source'].empty?
          full = if normalized['source'].start_with?('raw/sources/')
            safe_source_path(normalized['source'])
          else
            safe_wiki_page_path(normalized['source'])
          end
          error!('Review source does not exist in the selected knowledge base', status: 400) unless File.file?(full)
        end
        normalized
      end
      selected = []; added = []; counts = nil
      identity = ->(item) { %w[type title detail source].map { |key| item[key].to_s.strip } }
      Storage.with_lock(File.join(current_project_path, '.llm-wiki/write.lock')) do
        queue_path = File.join(current_project_path, Review::REVIEW_FILE)
        if File.exist?(queue_path)
          begin
            saved = JSON.parse(File.read(queue_path))
            error!('Review queue is invalid; repair it before adding items', status: 409) unless saved.is_a?(Array) && saved.all? { |row| row.is_a?(Hash) }
          rescue JSON::ParserError
            error!('Review queue is invalid; repair it before adding items', status: 409)
          end
        end
        existing = Review.list(current_project_path)
        items.each do |item|
          key = identity.call(item)
          row = (existing + added).find { |candidate| identity.call(candidate) == key }
          unless row
            row = item.merge('id'=>"review-#{Digest::SHA256.hexdigest(JSON.generate(key))}", 'status'=>'pending', 'created_at'=>Time.now.utc.iso8601)
            added << row
          end
          selected << row unless selected.any? { |candidate| candidate['id'] == row['id'] }
        end
        Review.add_items(current_project_path, added) unless added.empty?
        counts = Review.counts(current_project_path)
      end
      json(ok: true, added: added.length, duplicates: items.length - added.length, items: selected, counts: counts)
    end
    if path == '/research/tasks' && req.request_method == 'POST'
      require_project!
      task = json_body.fetch('task')
      error!('Invalid research task', status: 400) unless task.is_a?(Hash) && task['id'].is_a?(String) && task['topic'].is_a?(String)
      file = File.join(current_project_path, '.llm-wiki/research-tasks.json')
      Storage.with_lock(File.join(current_project_path, '.llm-wiki/write.lock')) do
        rows = File.exist?(file) ? JSON.parse(File.read(file)) : []
        rows.reject! { |row| row['id'] == task['id'] };rows << task
        Storage.atomic_write(file, JSON.pretty_generate(rows.last(50)))
      end
      json(ok: true)
    end
    if req.request_method == 'POST' && path == '/projects/open-existing'
      source = File.expand_path(json_body.fetch('path'))
      reject_links!(source)
      error!('Session evidence libraries must be read through the bundled Reader; do not open them as editable wikis', status: 409) if File.exist?(File.join(source, 'audit/completion-report.json')) || File.exist?(File.join(source, 'knowledge-index.json'))
      loaded = if !wiki_project?(source) && portable_legacy_project?(source)
        project = migrate_compatible_legacy_project(source, allow_explicit_portable: true)
        { 'project'=>project, 'imported'=>false, 'created'=>false, 'migrated'=>true }
      else
        WikiImport.load_folder(source, projects_root)
      end
      complete_contentful_project_metadata(loaded.fetch('project')['path'])
      error!('Selected folder did not produce a valid knowledge base', status: 409) unless wiki_project?(loaded.fetch('project')['path'])
      project = loaded.fetch('project'); remember_project(project['path']); touch_project_access(project['path'])
      json(loaded.merge('already_loaded'=>!loaded['created']))
    end
    if req.request_method == 'DELETE' && path == '/sources'
      require_project!
      rel = body_or_query_param('path');full = safe_source_path(rel)
      error!('Source not found', status: 404) unless File.file?(full)
      receipt = nil
      Storage.with_lock(File.join(current_project_path, '.llm-wiki/write.lock')) do
        receipt = CascadeDelete.send(:move_to_recoverable_trash, current_project_path, full, trash_dir: File.join(current_project_path, '.llm-wiki/trash'))
      end
      best_effort_after_commit('record source deletion') { ActivityLog.record(current_project_path, 'source_trashed', rel, actor: 'user') }
      json(ok: true, path: rel, trashed: true, original_path: full)
    end
    if req.request_method == 'DELETE' && path == '/wiki/page'
      require_project!
      rel = body_or_query_param('path'); safe_wiki_page_path(rel)
      result = CascadeDelete.delete_page(current_project_path, rel, trash_dir: File.join(current_project_path, '.llm-wiki/trash'))
      error!(result['error'], status: result['status'] || 409) unless result['ok']
      best_effort_after_commit('record page deletion') { ActivityLog.record(current_project_path, 'page_trashed', rel, actor: 'user') }
      json(result)
    end
    if path == '/trash' && req.request_method == 'GET'
      require_project!
      root = File.join(current_project_path, '.llm-wiki/trash')
      files = Dir.glob(File.join(root, '*.metadata.json')).map { |p| JSON.parse(File.read(p)).merge('receipt'=>File.basename(p)) }
      json(files: files)
    end
    if req.request_method == 'POST' && path == '/trash/restore'
      require_project!
      root = File.join(current_project_path, '.llm-wiki/trash')
      original = File.expand_path(json_body.fetch('original_path'))
      rel = original.delete_prefix(current_project_path + '/')
      target = rel.start_with?('raw/sources/') ? safe_source_path(rel) : safe_wiki_page_path(rel)
      Storage.with_lock(File.join(current_project_path, '.llm-wiki/write.lock')) do
        error!('Restore destination already exists', status: 409) if File.exist?(target)
        receipt = Dir.glob(File.join(root, '*.metadata.json')).sort.reverse.find { |p| JSON.parse(File.read(p))['original_path'] == original }
        error!('Trash entry not found', status: 404) unless receipt
        FileUtils.mkdir_p(File.dirname(target)); File.rename(receipt.delete_suffix('.metadata.json'), target); File.delete(receipt)
      end
      json(ok: true, original_path: target)
    end
    # A named wiki is created only after the user supplies its purpose in UI/skill.
    error!('This action runs through the LLM Wiki skill in Codex', status: 404) unless ALLOWED.include?(path)
    error!('Whole-library deletion is not available', status: 405) if path == '/projects' && req.request_method == 'DELETE'
    if path == '/global-project' && req.request_method == 'POST' && json_body['path']
      error!('Open this knowledge base first', status: 403) unless registered_paths.include?(File.expand_path(json_body['path']))
    end
    block = self.class.routes[[req.request_method, path]]
    error!('Unknown route', status: 404) unless block
    if req.request_method == 'POST' && %w[/wiki/page /wiki/page/metadata].include?(path)
      require_project!
      Storage.with_lock(File.join(current_project_path, '.llm-wiki/write.lock')) do
        target = safe_wiki_page_path(json_body['path'].to_s)
        error!('Read the current page revision before updating', status: 409) if File.exist?(target) && json_body['revision'].to_s.empty? && json_body['create'] != true
        instance_exec(&block)
      end
    else
      instance_exec(&block)
    end
  end
end

def run_server
  options = {port: 0}
  OptionParser.new do |p|
    p.on('--data DIR') { |v| options[:data] = File.expand_path(v) }
    p.on('--port PORT', Integer) { |v| options[:port] = v }
    p.on('--ready FILE') { |v| options[:ready] = v }
    p.on('--fingerprint HASH') { |v| options[:fingerprint] = v }
  end.parse!
  abort 'Specify --data with an explicitly chosen private directory' unless options[:data]
  FileUtils.mkdir_p(options[:data], mode: 0700)
  token = SecureRandom.hex(32)
  server = WEBrick::HTTPServer.new(BindAddress:'127.0.0.1', Port:options[:port], AccessLog:[], Logger:WEBrick::Log.new($stderr, WEBrick::Log::WARN), MaxClients:8)
  port = server.config[:Port]
  origin = "http://127.0.0.1:#{port}"
  mutex = Mutex.new
  handler = proc do |req, res|
    begin
      raise Clacky::ApiExtension::Halt.new(403, JSON.generate(error:'Invalid host')) unless req['Host'] == "127.0.0.1:#{port}"
      raise Clacky::ApiExtension::Halt.new(403, JSON.generate(error:'Cross-origin requests are blocked')) unless req['Origin'].to_s.empty? || req['Origin'] == origin
      supplied = req['X-LLM-Wiki-Token'].to_s
      cookie = req.cookies.find { |c| c.name == 'llmwiki' }&.value.to_s
      authenticated = supplied == token || cookie == token
      if req.path == '/' && req.query['token'] == token
        res['Set-Cookie'] = "llmwiki=#{token}; HttpOnly; SameSite=Strict; Path=/"
        res.status=303; res['Location']='/'; next
      end
      raise Clacky::ApiExtension::Halt.new(401, JSON.generate(error:'Open the private launch URL from Codex')) unless authenticated
      raise Clacky::ApiExtension::Halt.new(413, JSON.generate(error:'Request too large')) if req.body.to_s.bytesize > 36 * 1024 * 1024
      res['Cache-Control']='no-store'; res['X-Content-Type-Options']='nosniff'; res['Referrer-Policy']='no-referrer'
      if req.path == '/' && req.request_method == 'GET'
        res['Content-Type']='text/html; charset=utf-8'
        res.body='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent wiki</title><style>html,body,#root{margin:0;height:100%;background:#f8faf8}.llm-wiki-root{height:100vh!important}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
      elsif req.path == '/app.js' && req.request_method == 'GET'
        res['Content-Type']='application/javascript';res.body=File.binread(File.join(WORKSPACE,'panels/wiki-app/view.js'))
      elsif req.path == '/api/wiki/health' && req.request_method == 'GET'
        # Keep lifecycle identity independent of slow operations holding mutex.
        res['Content-Type']='application/json'
        res.body=JSON.generate(ok:true, pid:Process.pid, data:options[:data], fingerprint:options[:fingerprint])
      elsif req.path.start_with?('/api/wiki/')
        mutex.synchronize { LlmWikiHandler.new(req, options[:data]).dispatch(req.path.delete_prefix('/api/wiki')) }
      else
        raise Clacky::ApiExtension::Halt.new(404, JSON.generate(error:'Not found'))
      end
    rescue Clacky::ApiExtension::Halt => e
      res.status=e.status;res.body=e.body;res['Content-Type']=e.content_type;e.extra_headers.each { |k,v| res[k]=v }
    rescue JSON::ParserError, KeyError, ArgumentError => e
      res.status=400;res['Content-Type']='application/json';res.body=JSON.generate(error:e.message)
    rescue StandardError => e
      warn "#{e.class}: #{e.message}\n#{e.backtrace.first(4).join("\n")}"
      res.status=500;res['Content-Type']='application/json';res.body=JSON.generate(error:'Local operation failed; check the server log')
    end
  end
  servlet = Class.new(WEBrick::HTTPServlet::AbstractServlet) do
    define_method(:service) { |req,res| handler.call(req,res) }
  end
  server.mount('/', servlet)
  info = {fingerprint:options[:fingerprint], code_root:__dir__, pid:Process.pid, url:origin, launch_url:"#{origin}/?token=#{token}", token:token, data:options[:data]}
  if options[:ready]
    File.open(options[:ready], File::WRONLY|File::CREAT|File::TRUNC, 0600) { |f| f.write(JSON.generate(info)) }
    File.chmod(0600, options[:ready])
  end
  puts JSON.generate(ready:true, url:origin);$stdout.flush
  trap('INT') { server.shutdown };trap('TERM') { server.shutdown }
  server.start
end
run_server if $PROGRAM_NAME == __FILE__

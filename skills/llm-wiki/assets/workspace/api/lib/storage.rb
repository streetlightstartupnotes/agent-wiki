# frozen_string_literal: true

# Storage — small, dependency-free persistence helpers.
#
# Writes are performed through a temporary file in the destination directory and
# renamed into place. Readers therefore see either the old complete file or the
# new complete file, never a partially-written document.
module Storage
  extend self

  def atomic_write(path, content, encoding: "utf-8", binary: false)
    FileUtils.mkdir_p(File.dirname(path))
    temp = File.join(File.dirname(path), ".#{File.basename(path)}.tmp-#{Process.pid}-#{SecureRandom.hex(5)}")
    mode = binary ? "wb" : "w"
    options = binary ? {} : { encoding: encoding }

    File.open(temp, mode, **options) do |file|
      file.write(content)
      file.flush
      file.fsync rescue nil
    end
    replace_file(temp, path)
    path
  ensure
    File.delete(temp) if temp && File.exist?(temp)
  end

  def with_lock(path)
    FileUtils.mkdir_p(File.dirname(path))
    File.open(path, File::RDWR | File::CREAT, 0o600) do |file|
      locked = begin
        file.flock(File::LOCK_EX) != false
      rescue NotImplementedError, SystemCallError
        false
      end
      locked ? yield : process_lock(path).synchronize { yield }
    ensure
      file.flock(File::LOCK_UN) if locked
    end
  end

  def update_json(path, default)
    with_lock("#{path}.lock") do
      current = if File.exist?(path)
        JSON.parse(File.read(path, encoding: "utf-8"))
      else
        deep_copy(default)
      end
      raise ArgumentError, "Stored JSON has an unexpected shape: #{File.basename(path)}" unless current.is_a?(default.class)
      updated = yield(current)
      atomic_write(path, JSON.pretty_generate(updated), encoding: "utf-8")
      updated
    end
  end

  def revision(path)
    File.file?(path) ? Digest::SHA256.file(path).hexdigest : nil
  end

  private

  # POSIX rename replaces an existing destination atomically, but native
  # Windows Ruby can raise EACCES/EPERM/EEXIST instead. New-project onboarding
  # writes project-meta.json twice (initialize, then mark provisional), so that
  # platform difference used to leave Windows users with a half-created wiki.
  def replace_file(source, destination)
    File.rename(source, destination)
  rescue Errno::EACCES, Errno::EPERM, Errno::EEXIST
    raise unless File.file?(destination)

    backup = File.join(File.dirname(destination), ".#{File.basename(destination)}.bak-#{Process.pid}-#{SecureRandom.hex(5)}")
    File.rename(destination, backup)
    begin
      File.rename(source, destination)
      File.delete(backup)
    rescue Exception
      File.rename(backup, destination) if File.exist?(backup) && !File.exist?(destination)
      raise
    ensure
      File.delete(backup) if File.exist?(backup) && File.exist?(destination)
    end
  end

  def process_lock(path)
    process_locks_guard.synchronize do
      @process_locks ||= {}
      @process_locks[File.expand_path(path)] ||= Mutex.new
    end
  end

  def process_locks_guard
    @process_locks_guard ||= Mutex.new
  end

  def deep_copy(value)
    Marshal.load(Marshal.dump(value))
  end
end

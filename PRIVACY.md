# Privacy

This local plugin has no hosted service or telemetry. The companion binds only to 127.0.0.1 and protects its API with a private runtime token. Wiki and session evidence files remain in user-chosen local directories. Using Codex to read those files processes selected content under the user’s Codex account and provider settings; this is not a claim of fully offline inference. Research may access user-requested external sources.

Installation grants no permission to scan all sessions or write personal memory. Session tools require explicit source/destination scope and redact known sensitive patterns; automatic redaction is not guaranteed to detect every secret. No credentials or personal histories are bundled. The plugin does not modify original session logs. Local trash and user backups may retain deleted content; restoring a page never overwrites an existing file.

External images are blocked in the native workspace by default. The user may explicitly list exact HTTPS origins in settings. Reopening the panel declares those origins through MCP Apps resourceDomains (the host's shared resource policy); permitted image websites receive requests when their images are displayed. No generic image proxy is installed, and saving a policy does not fetch images or scan knowledge.

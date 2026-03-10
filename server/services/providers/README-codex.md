# Codex CLI OAuth Provider

This provider enables authentication with OpenAI Codex CLI for **local deployment only**.

## Overview

The Codex provider integrates with the OpenAI Codex CLI authentication system. It reads cached authentication tokens from the Codex CLI's local auth cache (`~/.codex/auth.json`) or uses the `OPENAI_API_KEY` environment variable.

## Setup

### Prerequisites

1. Install the OpenAI Codex CLI:
   ```bash
   npm install -g @openai/codex
   ```

2. Sign in to Codex CLI:
   ```bash
   codex login
   ```

   This will open a browser window for you to complete the OAuth flow. After successful login, credentials are cached at `~/.codex/auth.json`.

### Configuration

1. Set the AI provider to `codex`:
   ```bash
   AI_PROVIDER=codex
   ```

2. (Optional) Specify a Codex model:
   ```bash
   CODEX_MODEL=codex
   ```

3. (Optional) Use API key instead of OAuth cache:
   ```bash
   OPENAI_API_KEY=sk-...
   ```

4. (Optional) Set OpenAI organization/project:
   ```bash
   OPENAI_ORGANIZATION=org-...
   OPENAI_PROJECT=proj-...
   ```

5. (Optional) Custom Codex home directory:
   ```bash
   CODEX_HOME=/custom/path/.codex
   ```

## Authentication Flow

The provider checks for authentication tokens in this order:

1. **Environment Variable**: `OPENAI_API_KEY` (highest priority)
2. **Cached OAuth Token**: From `~/.codex/auth.json`

### Token Cache Location

By default, Codex CLI stores credentials at:
- **macOS/Linux**: `~/.codex/auth.json`
- **Windows**: `%USERPROFILE%\.codex\auth.json`

You can override this with the `CODEX_HOME` environment variable.

### Credential Storage

Codex CLI supports two storage methods (configured via `cli_auth_credentials_store`):
- `file`: Credentials in `auth.json` (default fallback)
- `keyring`: OS credential store (more secure)

This provider reads from the file-based storage. If using keyring storage, ensure `cli_auth_credentials_store = "file"` in your Codex config.

## Usage

### Local Development

```bash
# 1. Login to Codex CLI
codex login

# 2. Set environment
export AI_PROVIDER=codex

# 3. Run your server
npm start
```

### CI/CD or Automated Workflows

For programmatic workflows, use API key authentication:

```bash
export AI_PROVIDER=codex
export OPENAI_API_KEY=sk-...
npm start
```

**Security Note**: Do not expose Codex execution in untrusted or publicly triggerable environments.

## Error Handling

### Common Errors

**"Codex authentication required"**
- Run `codex login` to authenticate
- Or set `OPENAI_API_KEY` environment variable

**"No valid token found in Codex auth file"**
- Your session may have expired
- Run `codex login` again to refresh

**"Codex authentication failed"**
- Token has expired or been revoked
- Re-authenticate with `codex login`

## Security Considerations

⚠️ **Important Security Notes**:

1. **Local Deployment Only**: This provider is designed for local development environments where you control the machine.

2. **Token Security**: The `~/.codex/auth.json` file contains access tokens. Treat it like a password:
   - Never commit it to version control
   - Never share it in chat or tickets
   - Never paste it into public forums

3. **Production Use**: For production deployments, use API key authentication with proper secret management (e.g., environment variables, secret managers).

4. **Headless Environments**: For remote/headless machines, either:
   - Copy auth cache from a local machine (securely via SCP)
   - Use API key authentication
   - Use SSH port forwarding for OAuth callback

## References

- [OpenAI Codex Authentication Docs](https://developers.openai.com/codex/auth/)
- [Codex CLI Documentation](https://developers.openai.com/codex/cli/)

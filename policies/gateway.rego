package gateway.authz

import future.keywords.if
import future.keywords.in

# ---------------------------------------------------------------------------
# Default: deny everything
# ---------------------------------------------------------------------------
default allow := false

# ---------------------------------------------------------------------------
# ALLOW — hook sources (IDE events) are always allowed at gateway level.
# Enforcement is handled by local policy on the client side.
# ---------------------------------------------------------------------------
allow if { hook_source }

# ALLOW — MCP upstream calls must pass all conditions
allow if {
    not hook_source
    not missing_tool
    tool_allowed
    not dangerous_args
    not role_restricted
}

# ---------------------------------------------------------------------------
# REASON — priority-ordered explanation (first matching branch wins)
# ---------------------------------------------------------------------------
reason := "allowed" if { allow }

else := "tool not specified" if { missing_tool }

else := "tool not in allowlist for this upstream" if {
    not hook_source
    not missing_tool
    not tool_allowed
}

else := "dangerous argument pattern detected" if {
    not hook_source
    not missing_tool
    tool_allowed
    dangerous_args
}

else := "role restriction: insufficient permissions for write operations" if {
    not hook_source
    not missing_tool
    tool_allowed
    not dangerous_args
    role_restricted
}

else := "denied by policy"

# ---------------------------------------------------------------------------
# REDACTIONS — fields to strip from the upstream response
# Admin actors see everything; others have sensitive keys redacted.
# ---------------------------------------------------------------------------
redactions := {} if { "admin" in input.roles }

else := {
    "secretKey": true,
    "password": true,
    "token": true,
    "apiKey": true,
    "secret": true,
    "privateKey": true,
}

# ---------------------------------------------------------------------------
# MAX ARGS SIZE — reject payloads larger than this (bytes, checked by gateway)
# ---------------------------------------------------------------------------
max_args_size := 102400 # 100 KB

# ---------------------------------------------------------------------------
# TOOL ALLOWLISTS — per upstreamId
# ---------------------------------------------------------------------------
tool_allowlists := {
    "fs-server":   {"readFile", "listDir", "writeFile"},
    "http-server": {"fetchUrl", "postUrl"},
}

# Helper: hook source — IDE events forwarded via CLI hooks (ext:* upstreamId)
hook_source if { startswith(input.upstreamId, "ext:") }

# Helper: tool is missing / empty
missing_tool if { not input.tool }
missing_tool if { input.tool == "" }

# Helper: tool is in the allowlist for the given upstream
tool_allowed if {
    allowed := tool_allowlists[input.upstreamId]
    input.tool in allowed
}

# ---------------------------------------------------------------------------
# DANGEROUS ARGUMENT PATTERNS
# Block path traversal, shell injection, and template-injection tokens.
# ---------------------------------------------------------------------------
dangerous_patterns := [
    "../",     # Unix path traversal
    "..\\",    # Windows path traversal
    ";",       # Shell command separator
    "&&",      # Shell AND
    "||",      # Shell OR
    "`",       # Shell backtick
    "$(",      # Shell command substitution
    "${",      # Shell / template variable
    "%2e%2e",  # URL-encoded dot-dot
    "%252e",   # Double-encoded dot
]

dangerous_args if {
    some key
    val := input.args[key]
    is_string(val)
    some pattern in dangerous_patterns
    contains(val, pattern)
}

# ---------------------------------------------------------------------------
# ROLE RESTRICTIONS
# Write tools require editor or admin role; viewer cannot write.
# ---------------------------------------------------------------------------
write_tools := {"writeFile", "postUrl"}

role_restricted if {
    input.tool in write_tools
    "viewer" in input.roles
    not "admin" in input.roles
    not "editor" in input.roles
}

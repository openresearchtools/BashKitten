package com.danielealbano.androidremotecontrolmcp.mcp

import com.danielealbano.androidremotecontrolmcp.mcp.auth.McpAuthConfig
import com.danielealbano.androidremotecontrolmcp.mcp.auth.McpAuthPlugin
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.modelcontextprotocol.kotlin.sdk.types.McpJson

/**
 * Installs the MCP application base plugins in the ONE canonical order shared by production
 * ([McpServer.configureApplication]) and the integration tests:
 *
 * 1. [ContentNegotiation] with `json(McpJson)` — required by the SDK Streamable HTTP transport.
 * 2. [configureCors] — MUST precede auth so token-less browser preflight `OPTIONS` are answered by
 *    CORS instead of being failed closed (401) by the auth plugin.
 * 3. [McpAuthPlugin] — combined bearer/OAuth authentication, configured by the caller.
 *
 * Centralizing the order here makes the CORS-before-auth invariant impossible to break by reordering
 * a single caller: every caller (production and tests) goes through this function, and the integration
 * tests exercise it directly, so a regression in the ordering cannot pass unnoticed.
 *
 * @param configureAuth Caller-supplied [McpAuthConfig] block (tokens, OAuth validator, exclusions).
 */
fun Application.installMcpBasePlugins(configureAuth: McpAuthConfig.() -> Unit) {
    install(ContentNegotiation) { json(McpJson) }
    configureCors()
    install(McpAuthPlugin, configureAuth)
}

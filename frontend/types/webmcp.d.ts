interface NativeToolAnnotations {
  readOnlyHint: boolean
  consequentialHint: boolean
  untrustedContentHint: boolean
}
interface NativeToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: NativeToolAnnotations
  execute: (input: unknown) => unknown | Promise<unknown>
}
interface NativeModelContext {
  registerTool(tool: NativeToolDefinition, options: { signal: AbortSignal }): unknown | Promise<unknown>
  getTools(): NativeToolDefinition[] | Promise<NativeToolDefinition[]>
  executeTool(tool: NativeToolDefinition, input: unknown): unknown | Promise<unknown>
}
interface Document { readonly modelContext?: NativeModelContext }

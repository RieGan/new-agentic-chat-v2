# Task 06 provider error evidence

- Malformed scripted V4 tool JSON returns `PROVIDER_INVALID_RESPONSE` rather than throwing or returning unparsed arguments.
- Unsupported V4 finish reason returns `PROVIDER_INVALID_RESPONSE`.
- Malformed application messages return `PROVIDER_INVALID_REQUEST` without consuming a scripted step.
- Mismatched tool-call identity returns `PROVIDER_INVALID_CONTINUATION` before model invocation.
- Scripted provider failure and intercepted live HTTP failure return the fixed redacted `PROVIDER_FAILURE` result.
- Caller cancellation returns `PROVIDER_CANCELLED`; a subsequent request consumes only the next scripted step and succeeds without state bleed.
- A bounded 5 ms mock call prints only `PROVIDER_TIMEOUT`; the abort listener is removed when cancellation fires.
- The intercepted live request targeted `<baseURL>/responses` and its JSON body contained `store:false` and `parallel_tool_calls:false`. The result contained none of the configured base URL, model ID, or API key.
- Reasoning summaries are explicitly disabled with `reasoningSummary:null`; a scripted raw reasoning part was omitted from the normalized result.
- Context7 was quota-exhausted and codegraph timed out. Official AI SDK 7 documentation and installed `ai@7.0.66` / `@ai-sdk/openai@4.0.42` source and declarations were used as the prescribed fallback.

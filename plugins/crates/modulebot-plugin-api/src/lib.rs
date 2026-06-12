mod capability;
mod codec;
mod slash;
pub mod types;
mod wasm_abi;

pub use capability::{Capability, HttpMethod, HttpOriginPolicy};
pub use serde::{Deserialize, Serialize};
pub use slash::{
    agent_tool_definitions_result_for, agent_tool_result_for, manifest_for, manifest_result_for,
    plan_for, PluginEventHandler, PluginHandlerDefinition,
};
pub use types::{
    ActionPlan, AgentToolCall, AgentToolDefinition, AgentToolDefinitionsResult, AgentToolResult,
    BotEvent, DiscordEmbed, DiscordEmbedField, DiscordManifest, EffectRequest, EffectResult,
    LlmMessage, ManifestResult, PlanResult, PluginError, PluginManifest, PluginModuleInfo,
    SlashCommand, TriggerGroup, TriggerSource,
};
#[doc(hidden)]
pub use wasm_abi::{alloc_buffer, dealloc_buffer, return_value};

#[macro_export]
macro_rules! export_plugin {
    (
        id: $id:expr,
        version: $version:expr,
        trigger: $trigger:expr,
        subscribes: [$($subscribe:expr),* $(,)?],
        capabilities: [$($capability:expr),* $(,)?],

        handlers: [
            $(
                {
                    event: $event:expr,
                    handle: $handle:path $(,)?
                }
            ),* $(,)?
        ] $(,)?
    ) => {
        static MODULEBOT_SUBSCRIBES: &[&str] = &[$($subscribe),*];
        static MODULEBOT_HANDLERS: &[$crate::PluginHandlerDefinition] = &[
            $(
                $crate::PluginHandlerDefinition {
                    event: $event,
                    handle: $handle,
                },
            )*
        ];

        #[no_mangle]
        pub extern "C" fn alloc(size: usize) -> *mut u8 {
            $crate::alloc_buffer(size)
        }

        #[no_mangle]
        pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
            $crate::dealloc_buffer(ptr, len)
        }

        #[no_mangle]
        pub extern "C" fn manifest() -> u64 {
            $crate::return_value(&$crate::manifest_result_for(
                $id,
                $version,
                &$trigger,
                MODULEBOT_SUBSCRIBES,
                &[$($capability),*],
            ))
        }

        #[no_mangle]
        pub unsafe extern "C" fn plan(ptr: *const u8, len: usize) -> u64 {
            let input = std::slice::from_raw_parts(ptr, len);
            $crate::return_value(&$crate::plan_for(input, MODULEBOT_HANDLERS))
        }
    };
}

#[macro_export]
macro_rules! export_agent_tools {
    (
        id: $id:expr,
        version: $version:expr,
        capabilities: [$($capability:expr),* $(,)?],
        definitions: $definitions:path,
        execute: $execute:path $(,)?
    ) => {
        #[no_mangle]
        pub extern "C" fn alloc(size: usize) -> *mut u8 {
            $crate::alloc_buffer(size)
        }

        #[no_mangle]
        pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
            $crate::dealloc_buffer(ptr, len)
        }

        #[no_mangle]
        pub extern "C" fn manifest() -> u64 {
            $crate::return_value(&$crate::manifest_result_for(
                $id,
                $version,
                &$crate::TriggerGroup::None,
                &[],
                &[$($capability),*],
            ))
        }

        #[no_mangle]
        pub unsafe extern "C" fn plan(_ptr: *const u8, _len: usize) -> u64 {
            $crate::return_value(&$crate::PlanResult::Ok {
                plan: $crate::ActionPlan {
                    effects: Vec::new(),
                },
            })
        }

        $crate::export_agent_tools! {
            definitions: $definitions,
            execute: $execute,
        }
    };

    (
        id: $id:expr,
        version: $version:expr,
        definitions: $definitions:path,
        execute: $execute:path $(,)?
    ) => {
        $crate::export_agent_tools! {
            id: $id,
            version: $version,
            capabilities: [],
            definitions: $definitions,
            execute: $execute,
        }
    };

    (
        definitions: $definitions:path,
        execute: $execute:path $(,)?
    ) => {
        #[no_mangle]
        pub unsafe extern "C" fn tool_definitions() -> u64 {
            $crate::return_value(&$crate::agent_tool_definitions_result_for($definitions))
        }

        #[no_mangle]
        pub unsafe extern "C" fn execute_tool(ptr: *const u8, len: usize) -> u64 {
            let input = std::slice::from_raw_parts(ptr, len);
            $crate::return_value(&$crate::agent_tool_result_for(input, $execute))
        }
    };
}

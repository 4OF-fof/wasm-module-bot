mod capability;
mod codec;
mod slash;
pub mod types;
mod wasm_abi;

pub use capability::{Capability, HttpMethod, HttpOriginPolicy};
pub use serde::Serialize;
pub use slash::{
    manifest_for, manifest_result_for, plan_for, PluginEventHandler, PluginHandlerDefinition,
};
pub use types::{
    ActionPlan, BotEvent, DiscordEmbed, DiscordEmbedField, DiscordManifest, EffectRequest,
    EffectResult, ManifestResult, PlanResult, PluginError, PluginManifest, PluginModuleInfo,
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
        static PATCHOULI_SUBSCRIBES: &[&str] = &[$($subscribe),*];
        static PATCHOULI_HANDLERS: &[$crate::PluginHandlerDefinition] = &[
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
                PATCHOULI_SUBSCRIBES,
                &[$($capability),*],
            ))
        }

        #[no_mangle]
        pub unsafe extern "C" fn plan(ptr: *const u8, len: usize) -> u64 {
            let input = std::slice::from_raw_parts(ptr, len);
            $crate::return_value(&$crate::plan_for(input, PATCHOULI_HANDLERS))
        }
    };
}

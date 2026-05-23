# Patchouli ドキュメント

新規 plugin 開発者は次の順で読むことを想定しています。

1. [plugin-development.md](plugin-development.md): plugin の作成、build、host での実行手順。
2. [plugin-api.md](plugin-api.md): manifest、trigger、event、effect、capability の API 仕様。
3. [internal-architecture.md](internal-architecture.md): host と WASM plugin の内部境界、ABI、実行ループ。

実装上の正は `plugins/crates/patchouli-plugin-api` の Rust 型定義です。
TypeScript host 側の型は Rust crate から生成されます。

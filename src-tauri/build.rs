use std::{env, fs, path::Path};

fn main() {
    // lib.rs embeds inject.js via include_str!. Cargo's own include_str! change
    // detection isn't firing here, so editing inject.js alone wouldn't rebuild
    // (the dev watcher would relaunch a stale binary -- a real footgun). Copy it
    // into OUT_DIR and include from there: a build script's OUT_DIR output is
    // fingerprinted, so changing inject.js (via rerun-if-changed) re-runs this
    // script, rewrites the copy, and reliably recompiles the crate. Net effect:
    // `tauri dev` hot-reloads on inject.js edits.
    println!("cargo:rerun-if-changed=src/inject.js");
    let dest = Path::new(&env::var("OUT_DIR").unwrap()).join("inject.js");
    fs::copy("src/inject.js", &dest).expect("copy inject.js into OUT_DIR");

    // Любой rerun-if-changed выше отключает дефолтное отслеживание всех файлов
    // пакета, из-за чего правки иконок не переэмбедят dev-иконку в доке
    // (tauri_build вшивает default_window_icon на этапе сборки). Следим за ними.
    for entry in fs::read_dir("icons").expect("read icons dir") {
        let path = entry.expect("read icons entry").path();
        if path.is_file() {
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }

    tauri_build::build()
}

const LEGACY_API_TOKEN = /1\|[A-Za-z0-9]{32,}/g;

class NoEmbeddedApiCredentialPlugin {
  apply(compiler) {
    const { Compilation, sources } = compiler.webpack;
    compiler.hooks.thisCompilation.tap('NoEmbeddedApiCredentialPlugin', compilation => {
      compilation.hooks.processAssets.tap(
        {
          name: 'NoEmbeddedApiCredentialPlugin',
          stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_INLINE,
        },
        assets => {
          for (const [name, asset] of Object.entries(assets)) {
            if (!name.endsWith('.js')) continue;
            const original = asset.source().toString();
            const sanitized = original.replace(LEGACY_API_TOKEN, '__REMOVED_LEGACY_API_TOKEN__');
            if (sanitized !== original) {
              compilation.updateAsset(name, new sources.RawSource(sanitized));
            }
          }
        },
      );
    });
  }
}

module.exports = NoEmbeddedApiCredentialPlugin;

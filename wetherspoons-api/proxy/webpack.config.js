const path = require("path");
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");
const { IgnorePlugin } = require("webpack");
const NoEmbeddedApiCredentialPlugin = require("../../webpack/no-embedded-api-credential");

module.exports = {
    mode: "production",
    entry: "./src/app.ts",
    resolve: {
        extensions: [".js", ".jsx", ".json", ".ts", ".tsx"],
    },
    output: {
        libraryTarget: "commonjs",
        path: path.join(__dirname, "dist"),
        filename: "index.js",
        clean: true,
    },
    target: "node",
    module: {
        rules: [
            {
                // Include ts, tsx, js, and jsx files.
                test: /\.(ts|js)x?$/,
                exclude: /node_modules/,
                use: [
                    "babel-loader",
                ],
            },
        ],
    },
    plugins: [
        new ForkTsCheckerWebpackPlugin(),
        new IgnorePlugin({ resourceRegExp: /^aws-crt$/ }),
        new NoEmbeddedApiCredentialPlugin(),
    ],
    cache: {
        type: 'filesystem',
    },
};

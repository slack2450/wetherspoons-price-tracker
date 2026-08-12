const path = require('path');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const { IgnorePlugin } = require('webpack');

module.exports = {
  mode: 'production',
  entry: './src/app.ts',
  resolve: { extensions: ['.js', '.json', '.ts'] },
  output: {
    libraryTarget: 'commonjs',
    path: path.join(__dirname, 'dist'),
    filename: 'index.js',
    clean: true,
  },
  target: 'node',
  module: {
    rules: [{
      test: /\.(ts|js)x?$/,
      exclude: /node_modules/,
      use: ['babel-loader'],
    }],
  },
  plugins: [
    new ForkTsCheckerWebpackPlugin(),
    new IgnorePlugin({ resourceRegExp: /^aws-crt$/ }),
  ],
};

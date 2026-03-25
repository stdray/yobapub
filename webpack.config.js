var path = require('path');
var { execSync } = require('child_process');
var webpack = require('webpack');
var HtmlWebpackPlugin = require('html-webpack-plugin');
var CopyWebpackPlugin = require('copy-webpack-plugin');

function getAppVersion() {
  try {
    var hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    var date = execSync('git log -1 --format=%cd --date=short', { encoding: 'utf-8' }).trim();
    var count = execSync('git rev-list --count HEAD', { encoding: 'utf-8' }).trim();
    return count + '-' + hash + ' (' + date + ')';
  } catch (e) {
    return 'unknown';
  }
}

module.exports = function (_env, argv) {
  var isProd = argv.mode === 'production';

  return {
    entry: './src/ts/main.ts',
    output: {
      path: path.resolve(__dirname, isProd ? 'dist/release' : 'dist/dev'),
      filename: 'app.js',
      clean: true
    },
    target: ['web', 'es5'],
    devtool: isProd ? false : 'source-map',
    resolve: {
      extensions: ['.ts', '.js']
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: 'swc-loader',
            options: {
              jsc: {
                parser: { syntax: 'typescript' },
                target: 'es5'
              }
            }
          }
        },
        {
          test: /\.js$/,
          exclude: /node_modules[\\/](core-js|jquery|hls\.js)/,
          use: {
            loader: 'swc-loader',
            options: {
              jsc: { target: 'es5' }
            }
          }
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
        }
      ]
    },
    plugins: [
      new webpack.DefinePlugin({
        __APP_VERSION__: JSON.stringify(getAppVersion())
      }),
      new HtmlWebpackPlugin({
        template: './src/index.html',
        inject: 'body'
      }),
      new CopyWebpackPlugin({
        patterns: [
          { from: 'src/config.xml', to: 'config.xml', noErrorOnMissing: true },
          { from: 'src/icon.png', to: 'icon.png', noErrorOnMissing: true },
          { from: 'src/icon.svg', to: 'icon.svg', noErrorOnMissing: true },
          { from: 'src/.project', to: '.project', toType: 'file', noErrorOnMissing: true },
          { from: 'src/.tproject', to: '.tproject', toType: 'file', noErrorOnMissing: true }
        ]
      })
    ]
  };
};

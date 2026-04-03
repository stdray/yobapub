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
    return process.env.APP_VERSION || 'unknown';
  }
}

function getVersionInfo() {
  var semVer = process.env.GITVERSION_SEMVER;
  if (semVer) {
    return {
      version: semVer,
      sha: process.env.GITVERSION_SHA || '',
      shortSha: process.env.GITVERSION_SHORT_SHA || '',
      buildDate: process.env.GITVERSION_BUILD_DATE || '',
    };
  }
  return {
    version: getAppVersion(),
    sha: '', shortSha: '', buildDate: '',
  };
}

module.exports = function (_env, argv) {
  var isProd = argv.mode === 'production';

  return {
    entry: './ts/main.ts',
    output: {
      path: path.resolve(__dirname, isProd ? 'dist/release' : 'dist/dev'),
      filename: 'app.[contenthash:8].js',
      clean: true
    },
    target: ['web', 'es5'],
    externals: {
      'jquery': 'jQuery',
      'hls.js': 'Hls'
    },
    devServer: {
      host: '0.0.0.0',
      port: 8080,
      hot: false,
      liveReload: false,
      static: false,
      allowedHosts: 'all'
    },
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
          use: ['style-loader', 'css-loader', 'postcss-loader']
        }
      ]
    },
    plugins: [
      new webpack.DefinePlugin({
        __APP_VERSION__: JSON.stringify(getVersionInfo().version),
        __BUILD_SHA__: JSON.stringify(getVersionInfo().sha),
        __BUILD_SHORT_SHA__: JSON.stringify(getVersionInfo().shortSha),
        __BUILD_DATE__: JSON.stringify(getVersionInfo().buildDate),
      }),
      new HtmlWebpackPlugin({
        template: './index.html',
        inject: 'body'
      }),
      new CopyWebpackPlugin({
        patterns: [
          { from: 'node_modules/jquery/dist/jquery.min.js', to: 'vendor/jquery.min.js' },
          { from: 'node_modules/hls.js/dist/hls.min.js', to: 'vendor/hls.min.js' },
          { from: 'favicon-32.png', to: 'favicon-32.png' },
          { from: 'icon-192.png', to: 'icon-192.png' },
          { from: 'icon-512.png', to: 'icon-512.png' }
        ]
      })
    ]
  };
};

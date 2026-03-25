declare module 'dot' {
  interface TemplateSettings {
    evaluate: RegExp;
    interpolate: RegExp;
    encode: RegExp;
    use: RegExp;
    define: RegExp;
    conditional: RegExp;
    iterate: RegExp;
    varname: string;
    strip: boolean;
    append: boolean;
  }
  interface DoT {
    templateSettings: TemplateSettings;
    template(tmpl: string, c?: Partial<TemplateSettings>, def?: any): (data: any) => string;
  }
  var doT: DoT;
  export = doT;
}

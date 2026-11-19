// Ambient typing for inlining the generated PNG icons (as base64 data URIs) in
// tests, so their real dimensions can be verified without Node typings.
declare module "*.png?inline" {
  const dataUri: string;
  export default dataUri;
}

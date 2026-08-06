import { buildHelmetOptions } from './security-headers.config';

describe('buildHelmetOptions', () => {
  it('locks the CSP down to a default-deny policy suited to a JSON-only API origin', () => {
    const options = buildHelmetOptions();
    const directives = (
      options.contentSecurityPolicy as {
        directives: Record<string, string[]>;
      }
    ).directives;

    expect(directives.defaultSrc).toEqual(["'none'"]);
    expect(directives.scriptSrc).toEqual(["'none'"]);
    expect(directives.styleSrc).toEqual(["'none'"]);
    expect(directives.frameAncestors).toEqual(["'none'"]);
    expect(directives.objectSrc).toEqual(["'none'"]);
  });

  it('still allows same-origin images for the static avatar/document routes', () => {
    const options = buildHelmetOptions();
    const directives = (
      options.contentSecurityPolicy as {
        directives: Record<string, string[]>;
      }
    ).directives;

    expect(directives.imgSrc).toEqual(["'self'"]);
  });
});

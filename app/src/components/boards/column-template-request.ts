export function newColumnTemplateRequestId(generate: () => string = () => crypto.randomUUID()) {
  return generate();
}

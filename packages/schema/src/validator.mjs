function typeMatches(expected, value) {
  switch (expected) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}

function formatMatches(format, value) {
  if (typeof value !== "string") {
    return false;
  }

  if (format === "date-time") {
    return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  }

  if (format === "uri") {
    try {
      const parsed = new URL(value);
      return parsed.protocol.length > 1;
    } catch {
      return false;
    }
  }

  if (format === "uri-reference") {
    try {
      new URL(value, "https://devharness.invalid/");
      return true;
    } catch {
      return false;
    }
  }

  return true;
}

function decodePointerToken(token) {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolvePointer(document, pointer) {
  if (pointer === "" || pointer === "/") {
    return document;
  }

  return pointer
    .split("/")
    .slice(1)
    .map(decodePointerToken)
    .reduce((current, token) => current?.[token], document);
}

export class SchemaRegistry {
  constructor(schemas) {
    this.schemas = new Map();

    for (const schema of schemas) {
      if (!schema.$id) {
        throw new Error("Every registered schema requires a $id.");
      }
      if (this.schemas.has(schema.$id)) {
        throw new Error(`Duplicate schema id: ${schema.$id}`);
      }
      this.schemas.set(schema.$id, schema);
    }

    this.assertResolvableReferences();
  }

  resolve(reference, currentSchemaId) {
    const [documentReference, fragment = ""] = reference.split("#", 2);
    const documentId = documentReference || currentSchemaId;
    const document = this.schemas.get(documentId);

    if (!document) {
      throw new Error(`Unknown schema reference: ${reference}`);
    }

    const target = resolvePointer(document, fragment);
    if (target === undefined) {
      throw new Error(`Unknown schema fragment: ${reference}`);
    }

    return { schema: target, schemaId: documentId };
  }

  assertResolvableReferences() {
    const visit = (node, currentSchemaId) => {
      if (node === null || typeof node !== "object") {
        return;
      }

      if (typeof node.$ref === "string") {
        this.resolve(node.$ref, currentSchemaId);
      }

      for (const value of Object.values(node)) {
        visit(value, currentSchemaId);
      }
    };

    for (const [schemaId, schema] of this.schemas) {
      visit(schema, schemaId);
    }
  }

  validate(schemaId, value) {
    const schema = this.schemas.get(schemaId);
    if (!schema) {
      throw new Error(`Unknown schema id: ${schemaId}`);
    }

    const errors = [];
    this.validateNode(schema, value, "$", schemaId, errors);
    return { valid: errors.length === 0, errors };
  }

  validateNode(schema, value, path, currentSchemaId, errors) {
    if (schema.$ref) {
      const resolved = this.resolve(schema.$ref, currentSchemaId);
      this.validateNode(resolved.schema, value, path, resolved.schemaId, errors);
      return;
    }

    if (Object.hasOwn(schema, "const") && value !== schema.const) {
      errors.push({ path, message: `must equal ${JSON.stringify(schema.const)}` });
    }

    if (schema.enum && !schema.enum.some((candidate) => candidate === value)) {
      errors.push({ path, message: `must be one of ${schema.enum.join(", ")}` });
    }

    if (schema.type && !typeMatches(schema.type, value)) {
      errors.push({ path, message: `must be ${schema.type}` });
      return;
    }

    if (schema.type === "object") {
      const properties = schema.properties ?? {};
      for (const required of schema.required ?? []) {
        if (!Object.hasOwn(value, required)) {
          errors.push({ path: `${path}.${required}`, message: "is required" });
        }
      }

      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!Object.hasOwn(properties, key)) {
            errors.push({ path: `${path}.${key}`, message: "is not allowed" });
          }
        }
      }

      for (const [key, propertySchema] of Object.entries(properties)) {
        if (Object.hasOwn(value, key)) {
          this.validateNode(propertySchema, value[key], `${path}.${key}`, currentSchemaId, errors);
        }
      }
    }

    if (schema.type === "array") {
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push({ path, message: `must contain at least ${schema.minItems} items` });
      }

      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push({ path, message: `must contain at most ${schema.maxItems} items` });
      }

      if (schema.uniqueItems) {
        const serialized = value.map((item) => JSON.stringify(item));
        if (new Set(serialized).size !== serialized.length) {
          errors.push({ path, message: "must contain unique items" });
        }
      }

      if (schema.items) {
        value.forEach((item, index) => {
          this.validateNode(schema.items, item, `${path}[${index}]`, currentSchemaId, errors);
        });
      }
    }

    if (schema.type === "string") {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push({ path, message: `must contain at least ${schema.minLength} characters` });
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push({ path, message: `must match ${schema.pattern}` });
      }
      if (schema.format && !formatMatches(schema.format, value)) {
        errors.push({ path, message: `must match format ${schema.format}` });
      }
    }

    if (schema.type === "integer" || schema.type === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push({ path, message: `must be at least ${schema.minimum}` });
      }
      if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
        errors.push({ path, message: `must be greater than ${schema.exclusiveMinimum}` });
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push({ path, message: `must be at most ${schema.maximum}` });
      }
      if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) {
        errors.push({ path, message: `must be less than ${schema.exclusiveMaximum}` });
      }
    }
  }
}

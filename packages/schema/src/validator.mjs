function typeMatches(expected, value) {
  if (Array.isArray(expected)) {
    return expected.some((candidate) => typeMatches(candidate, value));
  }
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
    case "null":
      return value === null;
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
    const resolved = this.resolve(schemaId, schemaId.split("#", 1)[0]);

    const errors = [];
    this.validateNode(resolved.schema, value, "$", resolved.schemaId, errors);
    return { valid: errors.length === 0, errors };
  }

  validateNode(schema, value, path, currentSchemaId, errors) {
    if (schema === true) return;
    if (schema === false) {
      errors.push({ path, message: "is not allowed" });
      return;
    }

    if (schema.$ref) {
      const resolved = this.resolve(schema.$ref, currentSchemaId);
      this.validateNode(resolved.schema, value, path, resolved.schemaId, errors);
    }

    if (schema.allOf) {
      for (const branch of schema.allOf) {
        this.validateNode(branch, value, path, currentSchemaId, errors);
      }
    }

    if (schema.anyOf) {
      const matches = schema.anyOf.filter((branch) => {
        const branchErrors = [];
        this.validateNode(branch, value, path, currentSchemaId, branchErrors);
        return branchErrors.length === 0;
      });
      if (matches.length === 0) {
        errors.push({ path, message: "must match at least one anyOf branch" });
      }
    }

    if (schema.oneOf) {
      const matches = schema.oneOf.filter((branch) => {
        const branchErrors = [];
        this.validateNode(branch, value, path, currentSchemaId, branchErrors);
        return branchErrors.length === 0;
      });
      if (matches.length !== 1) {
        errors.push({ path, message: `must match exactly one oneOf branch; matched ${matches.length}` });
      }
    }

    if (schema.not !== undefined) {
      const branchErrors = [];
      this.validateNode(schema.not, value, path, currentSchemaId, branchErrors);
      if (branchErrors.length === 0) {
        errors.push({ path, message: "must not match the forbidden schema" });
      }
    }

    if (schema.if !== undefined) {
      const conditionErrors = [];
      this.validateNode(schema.if, value, path, currentSchemaId, conditionErrors);
      const selected = conditionErrors.length === 0 ? schema.then : schema.else;
      if (selected !== undefined) {
        this.validateNode(selected, value, path, currentSchemaId, errors);
      }
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

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
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

      if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
        errors.push({ path, message: `must contain at least ${schema.minProperties} properties` });
      }

      if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) {
        errors.push({ path, message: `must contain at most ${schema.maxProperties} properties` });
      }

      for (const [key, propertySchema] of Object.entries(properties)) {
        if (Object.hasOwn(value, key)) {
          this.validateNode(propertySchema, value[key], `${path}.${key}`, currentSchemaId, errors);
        }
      }
    }

    if (Array.isArray(value)) {
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

      const prefixCount = schema.prefixItems?.length ?? 0;
      schema.prefixItems?.forEach((itemSchema, index) => {
        if (index < value.length) {
          this.validateNode(itemSchema, value[index], `${path}[${index}]`, currentSchemaId, errors);
        }
      });

      if (schema.items !== undefined) {
        value.slice(prefixCount).forEach((item, offset) => {
          const index = prefixCount + offset;
          this.validateNode(schema.items, item, `${path}[${index}]`, currentSchemaId, errors);
        });
      }
    }

    if (typeof value === "string") {
      const scalarLength = [...value].length;
      if (schema.minLength !== undefined && scalarLength < schema.minLength) {
        errors.push({ path, message: `must contain at least ${schema.minLength} characters` });
      }
      if (schema.maxLength !== undefined && scalarLength > schema.maxLength) {
        errors.push({ path, message: `must contain at most ${schema.maxLength} characters` });
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push({ path, message: `must match ${schema.pattern}` });
      }
      if (schema.format && !formatMatches(schema.format, value)) {
        errors.push({ path, message: `must match format ${schema.format}` });
      }
    }

    if (typeof value === "number" && Number.isFinite(value)) {
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

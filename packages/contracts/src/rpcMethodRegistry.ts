import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import type { AuthEnvironmentScope } from "./auth.ts";
import { MethodRegistry } from "./methodRegistry.ts";

interface RpcEntry {
  schema: Rpc.Any;
  scope: AuthEnvironmentScope;
  handler: (...args: Array<any>) => any;
}

export class RpcMethodRegistry {
  readonly #methods = new MethodRegistry<string, RpcEntry>();
  #group: RpcGroup.RpcGroup<Rpc.Any> | undefined;

  register(
    methodName: string,
    schema: Rpc.Any,
    scope: AuthEnvironmentScope,
    handler: (...args: Array<any>) => any,
  ): void {
    this.#methods.register(methodName, { schema, scope, handler });
    this.#group = undefined;
  }

  getGroup(): RpcGroup.RpcGroup<Rpc.Any> {
    if (this.#group === undefined) {
      const schemas: Array<Rpc.Any> = [];
      for (const [, entry] of this.#methods.entries()) {
        schemas.push(entry.schema);
      }
      this.#group = RpcGroup.make(...schemas) as any;
    }
    return this.#group!;
  }

  getScopeMap(): Map<string, AuthEnvironmentScope> {
    const map = new Map<string, AuthEnvironmentScope>();
    for (const [key, entry] of this.#methods.entries()) {
      map.set(key, entry.scope);
    }
    return map;
  }

  handlers(): Record<string, (...args: Array<any>) => any> {
    const result: Record<string, (...args: Array<any>) => any> = {};
    for (const [key, entry] of this.#methods.entries()) {
      result[key] = entry.handler;
    }
    return result;
  }
}

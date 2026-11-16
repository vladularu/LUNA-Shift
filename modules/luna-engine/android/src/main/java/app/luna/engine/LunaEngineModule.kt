package app.luna.engine

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class LunaEngineModule : Module() {
  // The Rust registry is process-wide, including overlapping Expo reloads.
  private companion object { val transport = EngineTransport() }
  override fun definition() = ModuleDefinition {
    Name("LunaEngine")
    Constants("transportAbiVersion" to 1)
    AsyncFunction("invoke") { operation: String, payload: String, lane: String?, promise: Promise ->
      transport.invoke(operation, payload, lane,
        { text -> promise.resolve(text) },
        { promise.reject("ENGINE_TRANSPORT", "Native engine transport failed.", null) }
      )
    }
    AsyncFunction("invokeSource") { header: String, source: String, promise: Promise ->
      transport.invokeSource(header, source,
        { text -> promise.resolve(text) },
        { promise.reject("ENGINE_TRANSPORT", "Native source transport failed.", null) }
      )
    }
    AsyncFunction("invokeCalendarRanks") { header: String, ranks: String, promise: Promise ->
      transport.invokeCalendarRanks(header, ranks,
        { text -> promise.resolve(text) },
        { promise.reject("ENGINE_TRANSPORT", "Native rank transport failed.", null) }
      )
    }
    AsyncFunction("invokeCatalogFinalize") { header: String, ranks: String, promise: Promise ->
      transport.invokeCatalogFinalize(header, ranks,
        { text -> promise.resolve(text) },
        { promise.reject("ENGINE_TRANSPORT", "Native catalog transport failed.", null) }
      )
    }
    AsyncFunction("invokeFinancialCollationFinalize") { header: String, ranks: String, promise: Promise ->
      transport.invokeFinancialCollationFinalize(header, ranks,
        { text -> promise.resolve(text) },
        { promise.reject("ENGINE_TRANSPORT", "Native financial collation transport failed.", null) }
      )
    }
    AsyncFunction("invokeCalendarSource") { header: String, source: String, promise: Promise ->
      transport.invokeCalendarSource(header, source,
        { text -> promise.resolve(text) },
        { promise.reject("ENGINE_TRANSPORT", "Native calendar source transport failed.", null) }
      )
    }
    AsyncFunction("invokeCalendarWindowFinalize") { header: String, ranks: String, promise: Promise ->
      transport.invokeCalendarWindowFinalize(header, ranks,
        { text -> promise.resolve(text) },
        { promise.reject("ENGINE_TRANSPORT", "Native calendar rank transport failed.", null) }
      )
    }
    AsyncFunction("invokeFormResource") { header: String, body: String, promise: Promise ->
      transport.invokeFormResource(header,body,
        { text ->
          // This callback executes on the private form worker, never RN's JS
          // thread. Only a small metadata string and original plan cross back.
          try {
            val frame=JSONObject(text)
            require(frame.get("ok") is Boolean)
            val taken=frame.getBoolean("ok") && frame.optString("state")=="WRITE_PLAN_TAKEN"
            val rawPlan=if(frame.has("planBody")) frame.remove("planBody") else null
            val plan=if(taken) { require(rawPlan is String && rawPlan.toByteArray(Charsets.UTF_8).size<=16515072);rawPlan } else {require(rawPlan==null);null}
            val small=frame.toString()
            require(small.toByteArray(Charsets.UTF_8).size<=1048576)
            promise.resolve(mapOf("metadataJson" to small,"planBody" to plan))
          } catch (_: Exception) { promise.reject("ENGINE_TRANSPORT","Native form reply failed.",null) }
        },
        { promise.reject("ENGINE_TRANSPORT","Native form transport failed.",null) }
      )
    }
  }
}

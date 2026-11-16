package app.luna.engine

import java.nio.charset.StandardCharsets
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private fun call(transport: EngineTransport, operation: String, payload: String = "", lane: String? = null): CompletableFuture<String> {
  val result = CompletableFuture<String>()
  transport.invoke(operation, payload, lane, { result.complete(it) }, { result.completeExceptionally(IllegalStateException("ENGINE_TRANSPORT")) })
  return result
}
private fun failed(task: CompletableFuture<String>) {
  try { task.get(5, TimeUnit.SECONDS); error("EXPECTED_REJECTION") }
  catch (_: java.util.concurrent.ExecutionException) {}
}
fun main() {
  val gate = CountDownLatch(1)
  val started = CountDownLatch(1)
  val seen = mutableListOf<String>()
  EngineTransport { operation, bytes ->
    if (operation == 8) { started.countDown(); check(gate.await(5, TimeUnit.SECONDS)) }
    synchronized(seen) { seen.add(String(bytes, StandardCharsets.UTF_8)) }
    "{\"ok\":true}".toByteArray(StandardCharsets.UTF_8)
  }.use { transport ->
    val finance = call(transport, "runFinance", lane = "finance")
    check(started.await(5, TimeUnit.SECONDS))
    check(call(transport, "runChecks", lane = "checks").get(5, TimeUnit.SECONDS).contains("true"))
    // A blocked financial year cannot block editor/clock utilities.
    check(call(transport, "utility", "{}").get(5, TimeUnit.SECONDS).contains("true"))
    failed(call(transport,"utility","x".repeat(262145)))
    failed(call(transport,"utility","ä".repeat(131073)))
    val raw = "{ \"x\":\"ä猫🦀\\u0000\", \"null\":null }"
    call(transport, "execute", raw).get(5, TimeUnit.SECONDS)
    check(synchronized(seen) { seen.contains(raw) })
    failed(call(transport, "execute", "\ud800"))
    failed(call(transport, "unknown"))
    failed(call(transport, "info", "x"))
    failed(call(transport, "bindOwner", "ä".repeat(513)))
    failed(call(transport, "runChecks", lane = "wrong"))
    gate.countDown()
    finance.get(5, TimeUnit.SECONDS)
  }
  EngineTransport { _, _ -> byteArrayOf(0xc3.toByte(), 0x28) }.use { failed(call(it, "info")) }
  val block = CountDownLatch(1)
  val queued = CountDownLatch(1)
  EngineTransport { _, _ -> queued.countDown(); check(block.await(5, TimeUnit.SECONDS)); "{}".toByteArray() }.use { transport ->
    val first = call(transport, "execute", "{}")
    check(queued.await(5, TimeUnit.SECONDS))
    val second = call(transport, "execute", "{}")
    val third = call(transport, "execute", "{}")
    failed(call(transport, "execute", "{}"))
    block.countDown()
    listOf(first, second, third).forEach { it.get(5, TimeUnit.SECONDS) }
  }
  val closed = EngineTransport { _, _ -> "{}".toByteArray() }
  closed.close()
  failed(call(closed, "info"))
  val rawHeader = "{\"nullable\":null}"
  val rawSource = "{ \"text\":\"ä猫🦀\", \"zero\":0 }"
  EngineTransport(nativeSourceCall = { header, source ->
    check(String(header, StandardCharsets.UTF_8) == rawHeader)
    check(String(source, StandardCharsets.UTF_8) == rawSource)
    "{\"ok\":true}".toByteArray()
  }) { _, _ -> "{}".toByteArray() }.use { transport ->
    val result = CompletableFuture<String>()
    transport.invokeSource(rawHeader, rawSource, { result.complete(it) }, { result.completeExceptionally(IllegalStateException()) })
    check(result.get(5, TimeUnit.SECONDS).contains("true"))
    val malformed = CompletableFuture<String>()
    transport.invokeSource("{}", "\ud800", { malformed.complete(it) }, { malformed.completeExceptionally(IllegalStateException()) })
    failed(malformed)
  }
  EngineTransport { _, _ -> throw UnsatisfiedLinkError("synthetic-missing-native-module") }.use { failed(call(it, "info")) }
  EngineTransport(nativeRanksCall = { header, ranks ->
    check(String(header,StandardCharsets.UTF_8)==rawHeader)
    check(String(ranks,StandardCharsets.UTF_8)==rawSource)
    "{\"ok\":true}".toByteArray()
  }) { opcode, _ -> check(opcode==16); "{\"ok\":true}".toByteArray() }.use { transport ->
    check(call(transport,"snapshotCalendarCandidates","{}").get(5,TimeUnit.SECONDS).contains("true"))
    val ranks=CompletableFuture<String>()
    transport.invokeCalendarRanks(rawHeader,rawSource,{ranks.complete(it)},{ranks.completeExceptionally(IllegalStateException())})
    check(ranks.get(5,TimeUnit.SECONDS).contains("true"))
  }
  EngineTransport(nativeCatalogCall = { header, ranks ->
    check(Thread.currentThread().name == "luna-engine-preparation")
    check(String(header,StandardCharsets.UTF_8)==rawHeader)
    check(String(ranks,StandardCharsets.UTF_8)==rawSource)
    "{\"ok\":true}".toByteArray()
  }) { opcode, _ -> check(opcode==18); "{\"ok\":true}".toByteArray() }.use { transport ->
    check(call(transport,"snapshotCatalogCandidates","{}").get(5,TimeUnit.SECONDS).contains("true"))
    failed(call(transport,"snapshotCatalogCandidates","ä".repeat(513)))
    val ranks=CompletableFuture<String>()
    transport.invokeCatalogFinalize(rawHeader,rawSource,{ranks.complete(it)},{ranks.completeExceptionally(IllegalStateException())})
    check(ranks.get(5,TimeUnit.SECONDS).contains("true"))
    val malformed=CompletableFuture<String>()
    transport.invokeCatalogFinalize("{}","\ud800",{malformed.complete(it)},{malformed.completeExceptionally(IllegalStateException())})
    failed(malformed)
  }
  EngineTransport { opcode, _ ->
    check(opcode==19)
    check(Thread.currentThread().name=="luna-engine-preparation")
    "{\"ok\":true}".toByteArray()
  }.use { transport ->
    check(call(transport,"snapshotProfileClock","{}").get(5,TimeUnit.SECONDS).contains("true"))
    failed(call(transport,"snapshotProfileClock","ä".repeat(513)))
  }
  val preparationGate=CountDownLatch(1)
  val preparationStarted=CountDownLatch(1)
  EngineTransport(nativeFinancialCollationCall={ h,r ->
    check(Thread.currentThread().name=="luna-engine-preparation")
    check(String(h,StandardCharsets.UTF_8)==rawHeader)
    check(String(r,StandardCharsets.UTF_8)==rawSource)
    "{\"ok\":true}".toByteArray()
  }) { opcode,_ ->
    if(opcode==20){check(Thread.currentThread().name=="luna-engine-preparation");preparationStarted.countDown();check(preparationGate.await(5,TimeUnit.SECONDS))}
    if(opcode==21)check(Thread.currentThread().name=="luna-engine-preparation")
    if(opcode==22)check(Thread.currentThread().name=="luna-engine-control")
    "{\"ok\":true}".toByteArray()
  }.use { transport ->
    val prep=call(transport,"financialCollationPrepare","{}")
    check(preparationStarted.await(5,TimeUnit.SECONDS))
    check(call(transport,"financialCollationAbort","{}").get(5,TimeUnit.SECONDS).contains("true"))
    failed(call(transport,"financialCollationPrepare","x".repeat(8193)))
    failed(call(transport,"financialCollationCandidates","x".repeat(1025)))
    preparationGate.countDown();prep.get(5,TimeUnit.SECONDS)
    failed(call(transport,"financialCollationPrepare","ä".repeat(4097)))
    failed(call(transport,"financialCollationCandidates","ä".repeat(513)))
    check(call(transport,"financialCollationCandidates","{}").get(5,TimeUnit.SECONDS).contains("true"))
    val raw=CompletableFuture<String>()
    transport.invokeFinancialCollationFinalize(rawHeader,rawSource,{raw.complete(it)},{raw.completeExceptionally(IllegalStateException())})
    check(raw.get(5,TimeUnit.SECONDS).contains("true"))
    val malformed=CompletableFuture<String>()
    transport.invokeFinancialCollationFinalize("{}","\ud800",{malformed.complete(it)},{malformed.completeExceptionally(IllegalStateException())});failed(malformed)
  }
  val calendarGate=CountDownLatch(1)
  val calendarStarted=CountDownLatch(1)
  EngineTransport { opcode,_ ->
    if(opcode==26){check(Thread.currentThread().name=="luna-engine-calendar");calendarStarted.countDown();check(calendarGate.await(5,TimeUnit.SECONDS))}
    if(opcode==29)check(Thread.currentThread().name=="luna-engine-control")
    if(opcode==17)check(Thread.currentThread().name=="luna-engine-utilities")
    "{\"ok\":true}".toByteArray()
  }.use { transport ->
    val calendar=call(transport,"calendarWindowPrepare","{}")
    check(calendarStarted.await(5,TimeUnit.SECONDS))
    check(call(transport,"utility","{}").get(5,TimeUnit.SECONDS).contains("true"))
    check(call(transport,"calendarWindowAbort","{}").get(5,TimeUnit.SECONDS).contains("true"))
    val waiting=(1..3).map{call(transport,"calendarWindowRead","{}")}
    failed(call(transport,"calendarWindowRead","{}"))
    failed(call(transport,"calendarWindowPrepare","x".repeat(8193)))
    failed(call(transport,"calendarWindowCandidates","ä".repeat(513)))
    calendarGate.countDown();calendar.get(5,TimeUnit.SECONDS)
    waiting.forEach{it.get(5,TimeUnit.SECONDS)}
  }
  EngineTransport(nativeCalendarSourceCall={ h,r ->
    check(Thread.currentThread().name=="luna-engine-preparation")
    check(String(h,StandardCharsets.UTF_8)==rawHeader)
    check(String(r,StandardCharsets.UTF_8)==rawSource)
    "{\"ok\":true}".toByteArray()
  },nativeCalendarWindowCall={ h,r ->
    check(Thread.currentThread().name=="luna-engine-calendar")
    check(String(h,StandardCharsets.UTF_8)==rawHeader)
    check(String(r,StandardCharsets.UTF_8)==rawSource)
    "{\"ok\":true}".toByteArray()
  }) { opcode,_ ->
    check(opcode in 23..29)
    when(opcode){
      23,24 -> check(Thread.currentThread().name=="luna-engine-preparation")
      25,29 -> check(Thread.currentThread().name=="luna-engine-control")
      else -> check(Thread.currentThread().name=="luna-engine-calendar")
    }
    "{\"ok\":true}".toByteArray()
  }.use{transport ->
    for(operation in listOf("calendarBegin","calendarSeal","calendarAbort","calendarWindowPrepare","calendarWindowCandidates","calendarWindowRead","calendarWindowAbort")){
      check(call(transport,operation,"{}").get(5,TimeUnit.SECONDS).contains("true"))
    }
    val source=CompletableFuture<String>()
    transport.invokeCalendarSource(rawHeader,rawSource,{source.complete(it)},{source.completeExceptionally(IllegalStateException())})
    check(source.get(5,TimeUnit.SECONDS).contains("true"))
    val ranks=CompletableFuture<String>()
    transport.invokeCalendarWindowFinalize(rawHeader,rawSource,{ranks.complete(it)},{ranks.completeExceptionally(IllegalStateException())})
    check(ranks.get(5,TimeUnit.SECONDS).contains("true"))
    val malformed=CompletableFuture<String>()
    transport.invokeCalendarWindowFinalize("{}","\ud800",{malformed.complete(it)},{malformed.completeExceptionally(IllegalStateException())});failed(malformed)
    val oversized=CompletableFuture<String>()
    transport.invokeCalendarSource("ä".repeat(4097),"{}",{oversized.complete(it)},{oversized.completeExceptionally(IllegalStateException())});failed(oversized)
  }
  val formGate=CountDownLatch(1)
  val formStarted=CountDownLatch(1)
  EngineTransport(nativeFormCall={h,b ->
    check(Thread.currentThread().name=="luna-engine-forms")
    check(String(h,StandardCharsets.UTF_8)=="{}" && String(b,StandardCharsets.UTF_8)=="raw")
    formStarted.countDown();check(formGate.await(5,TimeUnit.SECONDS))
    ByteArray(4194305){0x61}
  }) {_,_->"{\"ok\":true}".toByteArray()}.use { transport ->
    fun form(h:String="{}",b:String="raw"):CompletableFuture<String>{
      val p=CompletableFuture<String>();transport.invokeFormResource(h,b,{p.complete(it)},{p.completeExceptionally(IllegalStateException())});return p
    }
    val active=form();check(formStarted.await(5,TimeUnit.SECONDS))
    val waiting=(1..3).map{form()}
    failed(form())
    failed(form("x".repeat(8193)))
    failed(form("{}","x".repeat(16515073)))
    check(call(transport,"utility","{}").get(5,TimeUnit.SECONDS).contains("true"))
    formGate.countDown();check(active.get(5,TimeUnit.SECONDS).length==4194305)
    waiting.forEach{check(it.get(5,TimeUnit.SECONDS).length==4194305)}
    failed(form("ä".repeat(4097)))
    failed(form("{}","\ud800"))
  }
  var calendarReplySize=4194305
  EngineTransport(nativeCalendarSourceCall={_,_->ByteArray(calendarReplySize){0x61}}) {_,_->"{}".toByteArray()}.use { transport ->
    fun calendarReply():CompletableFuture<String>{
      val result=CompletableFuture<String>();transport.invokeCalendarSource("{}","{}",{result.complete(it)},{result.completeExceptionally(IllegalStateException())});return result
    }
    check(calendarReply().get(5,TimeUnit.SECONDS).length==4194305)
    calendarReplySize=33554433
    failed(calendarReply())
  }
  println("Kotlin transport: original scalar/calendar cases, CalendarSource large reply bounds, separate bounded form queue/UTF8 cases passed")
}

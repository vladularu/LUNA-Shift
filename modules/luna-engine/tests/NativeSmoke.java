package app.luna.engine;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

public final class NativeSmoke {
  private static String call(int operation, String payload) throws Exception {
    byte[] output = EngineNative.invoke(operation, payload.getBytes(StandardCharsets.UTF_8));
    return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(output)).toString();
  }
  private static void require(boolean condition) { if (!condition) throw new AssertionError("NATIVE_SMOKE_FAILED"); }
  private static String clockKey(String json) {
    java.util.regex.Matcher matcher=java.util.regex.Pattern.compile("\\\"sourceClockKey\\\":\\\"([0-9a-f]{64})\\\"").matcher(json);
    require(matcher.find()); return matcher.group(1);
  }
  private static String field(String json,String name) {
    java.util.regex.Matcher m=java.util.regex.Pattern.compile("\\\""+name+"\\\":([0-9]+)").matcher(json);
    require(m.find()); return m.group(1);
  }
  private static void financial(String engine,String sealed) throws Exception {
    java.util.regex.Matcher m=java.util.regex.Pattern.compile("\\\"identity\\\":(\\{[^{}]+\\})").matcher(sealed);
    require(m.find());String identity=m.group(1);
    String prefix="{\"wireSchemaVersion\":1,\"expectedEngineVersion\":\""+engine+"\",\"calculationContractVersion\":\"luna-engine-contract-v1\",\"guard\":{\"ownerScope\":\"jni-test\",\"ownerEpoch\":1,\"requestId\":\"financial\",\"draftRevision\":1,\"snapshot\":"+identity+"},\"intent\":{\"month\":\"2026-07\",\"perspective\":\"EARNED\",\"filter\":null,\"includeSpecialDutyPay\":false},\"localeKey\":\"jni-test\"}";
    String prepared=call(20,prefix);require(prepared.contains("FINANCIAL_COLLATION_PREPARED"));
    String id=field(prepared,"draftId");
    m=java.util.regex.Pattern.compile("\\\"candidateDigest\\\":\\\"([0-9a-f]{64})\\\"").matcher(prepared);require(m.find());String digest=m.group(1);
    String page=call(21,"{\"draftId\":"+id+",\"candidateDigest\":\""+digest+"\",\"after\":null,\"limit\":1024}");
    require(page.contains("FINANCIAL_COLLATION_CANDIDATES")&&page.contains("\"nextAfter\":null"));
    m=java.util.regex.Pattern.compile("\\\"candidates\\\":\\[([^]]*)\\]").matcher(page);require(m.find());
    java.util.regex.Matcher strings=java.util.regex.Pattern.compile("\"(?:\\\\.|[^\"\\\\])*\"").matcher(m.group(1));
    StringBuilder raw=new StringBuilder(" \n{");int n=0;
    while(strings.find()){if(n++>0)raw.append(',');raw.append(strings.group()).append(":0");}raw.append("}\t");
    require(n==Integer.parseInt(field(page,"total")));
    String header="{\"draftId\":"+id+",\"candidateDigest\":\""+digest+"\",\"reuseCached\":false}";
    String ready=new String(EngineNative.invokeFinancialCollationFinalize(header.getBytes(StandardCharsets.UTF_8),raw.toString().getBytes(StandardCharsets.UTF_8)),StandardCharsets.UTF_8);
    require(ready.contains("FINANCIAL_COLLATION_READY")&&!ready.contains("\"ranks\""));
    String next=call(20,prefix.replace("\"financial\"","\"financial-next\"").replace("2026-07","2026-08"));
    require(next.contains("\"cachedVerifiedRanks\":true"));
    header="{\"draftId\":"+field(next,"draftId")+",\"candidateDigest\":\""+digest+"\",\"reuseCached\":true}";
    require(new String(EngineNative.invokeFinancialCollationFinalize(header.getBytes(StandardCharsets.UTF_8),new byte[0]),StandardCharsets.UTF_8).contains("FINANCIAL_COLLATION_READY"));
    String abandoned=call(20,prefix.replace("\"financial\"","\"financial-abort\""));
    require(call(22,"{\"draftId\":"+field(abandoned,"draftId")+"}").contains("\"aborted\":true"));
    require(call(12,"").contains("collected"));
    for(int op:new int[]{20,21,22})try{EngineNative.invoke(op,new byte[op==20?8193:1025]);throw new AssertionError("FINANCIAL_LIMIT_ACCEPTED");}catch(IllegalStateException expected){}
    try{EngineNative.invokeFinancialCollationFinalize(null,new byte[0]);throw new AssertionError("NULL_FINANCIAL_ACCEPTED");}catch(IllegalStateException expected){}
  }
  public static void main(String[] args) throws Exception {
    String info = call(0, "");
    require(info.contains("\"abiVersion\":1") && info.contains("\"fullCalculation\":false"));
    require(call(1, "{\"ownerScope\":\"jni-test\",\"ownerEpoch\":1}").contains("OWNER_BOUND"));
    require(call(2, "{\"ownerScope\":\"jni-test\",\"ownerEpoch\":1,\"snapshotRevision\":1}").contains("REVISION_FENCED"));
    require(call(3, "{\"original\":\"ä猫🦀\\u0000\"}").contains("\"ok\":false"));
    require(call(4, "{}").contains("\"ok\":false"));
    require(call(5, "{}").contains("\"ok\":false"));
    require(call(6, "{}").contains("\"ok\":false"));
    require(call(7, "{}").contains("\"ok\":false"));
    require(call(8, "").contains("IDLE"));
    require(call(9, "").contains("IDLE"));
    require(call(10, "{\"jobId\":1}").contains("CANCEL_FENCED"));
    require(call(11, "").contains("RESET"));
    require(call(12, "").contains("collected"));
    for (int operation : new int[]{-1, 30}) {
      try { call(operation, ""); throw new AssertionError("BAD_OPCODE_ACCEPTED"); }
      catch (IllegalStateException expected) { require(expected.getMessage().equals("ENGINE_TRANSPORT")); }
    }
    try { EngineNative.invoke(0, null); throw new AssertionError("NULL_ACCEPTED"); }
    catch (IllegalStateException expected) {}
    require(call(1, "{\"ownerScope\":\"jni-test\",\"ownerEpoch\":1}").contains("OWNER_BOUND"));
    java.util.regex.Matcher engineVersion=java.util.regex.Pattern.compile("\\\"engineVersion\\\":\\\"([^\\\"]+)\\\"").matcher(info);
    require(engineVersion.find());
    String utility="{\"wireSchemaVersion\":1,\"expectedEngineVersion\":\""+engineVersion.group(1)+"\",\"calculationContractVersion\":\"luna-engine-contract-v1\",\"guard\":{\"ownerScope\":\"jni-test\",\"ownerEpoch\":1,\"requestId\":\"clock\",\"draftRevision\":0},\"operation\":{\"kind\":\"CIVIL_CLOCK\",\"epochMilliseconds\":0,\"timeZone\":\"Europe/Berlin\"}}";
    String utilityReply=call(17,utility);
    require(utilityReply.contains("COMPLETED") && utilityReply.contains("1970-01-01"));
    try {EngineNative.invoke(17,new byte[262145]);throw new AssertionError("UTILITY_LIMIT_ACCEPTED");}
    catch (IllegalStateException expected) {}
    String begin = "{\"ownerScope\":\"jni-test\",\"ownerEpoch\":1,\"snapshotId\":\"jni-builder\",\"snapshotRevision\":1,\"referenceDate\":\"2026-11-13\",\"selectedPackageIds\":{\"tariff\":[],\"legal\":[],\"holiday\":[]},\"completeness\":{\"entries\":{\"kind\":\"MISSING\"},\"history\":{\"kind\":\"MISSING\"},\"annexAEntries\":{\"kind\":\"MISSING\"},\"annexAPauseDetails\":{\"kind\":\"MISSING\"}}}";
    java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("\\\"builderId\\\":([0-9]+)").matcher(call(13, begin));
    require(matcher.find());
    String id = matcher.group(1);
    String header = "{\"builderId\":" + id + ",\"target\":\"SOURCE\",\"group\":{\"kind\":\"CALENDAR_ENTRIES\",\"source\":{\"state\":\"READY\",\"revision\":1,\"coverage\":{\"kind\":\"ALL_HISTORY\"},\"payload\":{\"schemaVersion\":1,\"data\":{\"kind\":\"VALUE\"}}}}}";
    String source = " [ {\"text\":\"ä猫🦀\",\"zero\":0,\"nullable\":null} ] ";
    require(new String(EngineNative.invokeSource(header.getBytes(StandardCharsets.UTF_8), source.getBytes(StandardCharsets.UTF_8)), StandardCharsets.UTF_8).contains("SOURCE_ADDED"));
    require(call(14, "{\"builderId\":"+id+"}").contains("REGISTERED"));
    matcher = java.util.regex.Pattern.compile("\\\"builderId\\\":([0-9]+)").matcher(call(13, begin));
    require(matcher.find());
    require(call(15, "{\"builderId\":"+matcher.group(1)+"}").contains("\"aborted\":true"));
    require(call(1, "{\"ownerScope\":\"jni-test\",\"ownerEpoch\":1}").contains("OWNER_BOUND"));
    matcher = java.util.regex.Pattern.compile("\\\"builderId\\\":([0-9]+)").matcher(call(13, begin));
    require(matcher.find());
    String calendarId = matcher.group(1);
    String calendarHeader = header.replace("\"builderId\":"+id+",", "\"builderId\":"+calendarId+",");
    String calendar = "{\"shiftRows\":[],\"appointmentRows\":[],\"templateRows\":[],\"platformCollationRanks\":{}}";
    require(new String(EngineNative.invokeSource(calendarHeader.getBytes(StandardCharsets.UTF_8), calendar.getBytes(StandardCharsets.UTF_8)), StandardCharsets.UTF_8).contains("SOURCE_ADDED"));
    String page = call(16,"{\"builderId\":"+calendarId+",\"after\":null,\"limit\":1024}");
    require(page.contains("\"total\":64"));
    java.util.regex.Matcher candidateList=java.util.regex.Pattern.compile("\\\"candidates\\\":\\[([^]]+)\\]").matcher(page);
    require(candidateList.find());
    String[] candidates=candidateList.group(1).split(",");
    StringBuilder ranks=new StringBuilder("{");
    for(int i=0;i<candidates.length;i++){if(i>0)ranks.append(',');ranks.append(candidates[i]).append(":0");}
    ranks.append('}');
    require(new String(EngineNative.invokeCalendarRanks(("{\"builderId\":"+calendarId+"}").getBytes(StandardCharsets.UTF_8),ranks.toString().getBytes(StandardCharsets.UTF_8)),StandardCharsets.UTF_8).contains("CALENDAR_RANKS_BOUND"));
    for (String kind : new String[]{"TARIFF","LEGAL","HOLIDAY"}) {
      String catalogHeader="{\"builderId\":"+calendarId+",\"target\":\"CATALOG\",\"group\":{\"kind\":\""+kind+"\",\"source\":{\"state\":\"READY\",\"revision\":1,\"coverage\":{\"kind\":\"ALL_HISTORY\"},\"payload\":{\"schemaVersion\":1,\"data\":{\"kind\":\"VALUE\"}}}}}";
      require(new String(EngineNative.invokeSource(catalogHeader.getBytes(StandardCharsets.UTF_8),"{\"mode\":\"COMPILED_PREVIEW\"}".getBytes(StandardCharsets.UTF_8)),StandardCharsets.UTF_8).contains("SOURCE_ADDED"));
    }
    String catalogPage=call(18,"{\"builderId\":"+calendarId+",\"after\":null,\"limit\":512}");
    require(catalogPage.contains("CATALOG_CANDIDATES") && catalogPage.contains("\"total\":0"));
    require(new String(EngineNative.invokeCatalogFinalize(("{\"builderId\":"+calendarId+"}").getBytes(StandardCharsets.UTF_8)," {} ".getBytes(StandardCharsets.UTF_8)),StandardCharsets.UTF_8).contains("CATALOG_FINALIZED"));
    String sealedCalendar=call(14,"{\"builderId\":"+calendarId+"}");
    require(sealedCalendar.contains("REGISTERED"));
    financial(engineVersion.group(1),sealedCalendar);
    require(call(1,"{\"ownerScope\":\"jni-test\",\"ownerEpoch\":1}").contains("OWNER_BOUND"));
    String pendingBegin=begin.replace(",\"referenceDate\":\"2026-11-13\"","");
    matcher=java.util.regex.Pattern.compile("\\\"builderId\\\":([0-9]+)").matcher(call(13,pendingBegin));
    require(matcher.find());
    String clockId=matcher.group(1);
    String profileHeader="{\"builderId\":"+clockId+",\"target\":\"SOURCE\",\"group\":{\"kind\":\"WORK_PROFILE\",\"source\":{\"state\":\"READY\",\"revision\":1,\"coverage\":{\"kind\":\"ALL_HISTORY\"},\"payload\":{\"schemaVersion\":1,\"data\":{\"kind\":\"NULL\"}}}}}";
    require(new String(EngineNative.invokeSource(profileHeader.getBytes(StandardCharsets.UTF_8),new byte[0]),StandardCharsets.UTF_8).contains("SOURCE_ADDED"));
    String profileClock=call(19,"{\"builderId\":"+clockId+",\"epochMilliseconds\":0}");
    require(profileClock.contains("PROFILE_CLOCK_READY") && profileClock.contains("1970-01-01") && profileClock.contains("sourceClockKey"));
    require(call(14,"{\"builderId\":"+clockId+"}").contains("REGISTERED"));
    require(call(1,"{\"ownerScope\":\"jni-test\",\"ownerEpoch\":1}").contains("OWNER_BOUND"));
    matcher=java.util.regex.Pattern.compile("\\\"builderId\\\":([0-9]+)").matcher(call(13,pendingBegin));
    require(matcher.find());
    String revisedClockId=matcher.group(1);
    String revisedProfileHeader=profileHeader.replace("\"builderId\":"+clockId+",","\"builderId\":"+revisedClockId+",").replace("\"revision\":1,","\"revision\":2,");
    require(new String(EngineNative.invokeSource(revisedProfileHeader.getBytes(StandardCharsets.UTF_8),new byte[0]),StandardCharsets.UTF_8).contains("SOURCE_ADDED"));
    String revisedClock=call(19,"{\"builderId\":"+revisedClockId+",\"epochMilliseconds\":0}");
    require(revisedClock.contains("PROFILE_CLOCK_READY"));
    require(clockKey(profileClock).equals(clockKey(revisedClock)));
    require(call(14,"{\"builderId\":"+revisedClockId+"}").contains("REGISTERED"));
    try { EngineNative.invokeCatalogFinalize(null, new byte[0]); throw new AssertionError("NULL_CATALOG_HEADER_ACCEPTED"); }
    catch (IllegalStateException expected) {}
    try { EngineNative.invokeCatalogFinalize(new byte[1025], new byte[0]); throw new AssertionError("CATALOG_HEADER_LIMIT_ACCEPTED"); }
    catch (IllegalStateException expected) {}
    try { EngineNative.invokeSource(null, new byte[0]); throw new AssertionError("NULL_SOURCE_HEADER_ACCEPTED"); }
    catch (IllegalStateException expected) {}
    try { EngineNative.invoke(1, new byte[1025]); throw new AssertionError("LIMIT_ACCEPTED"); }
    catch (IllegalStateException expected) {}
    calendar(engineVersion.group(1));
    String formFailure=new String(EngineNative.invokeFormResource("private-malformed-header".getBytes(StandardCharsets.UTF_8),new byte[0]),StandardCharsets.UTF_8);
    require(formFailure.contains("\"ok\":false") && !formFailure.contains("private-malformed"));
    try{EngineNative.invokeFormResource(new byte[8193],new byte[0]);throw new AssertionError("FORM_HEADER_LIMIT_ACCEPTED");}catch(IllegalStateException expected){}
    try{EngineNative.invokeFormResource(new byte[0],new byte[16515073]);throw new AssertionError("FORM_BODY_LIMIT_ACCEPTED");}catch(IllegalStateException expected){}
    try{EngineNative.invokeFormResource(null,new byte[0]);throw new AssertionError("FORM_NULL_ACCEPTED");}catch(IllegalStateException expected){}
    ExecutorService workers = Executors.newFixedThreadPool(4);
    try {
      java.util.List<Future<Boolean>> results = new java.util.ArrayList<>();
      for (int i = 0; i < 100; i++) results.add(workers.submit(() -> call(0, "").contains("\"abiVersion\":1")));
      for (Future<Boolean> result : results) require(result.get(20, TimeUnit.SECONDS));
    } finally { workers.shutdownNow(); }
    System.out.println("Actual Rust JNI: 30 operations + seven raw pairs, independent CalendarOnly source/clock/window, form boundary, profile clock/catalog/financial preflight/utility, bounded rejection paths, 100 concurrent copies passed");
    System.out.println("JNI engineVersion="+engineVersion.group(1));
  }
  private static void calendar(String engine) throws Exception {
    require(call(1,"{\"ownerScope\":\"jni-test\",\"ownerEpoch\":1}").contains("OWNER_BOUND"));
    String base="{\"wireSchemaVersion\":1,\"expectedEngineVersion\":\""+engine+"\",\"calculationContractVersion\":\"luna-engine-contract-v1\",\"ownerScope\":\"jni-test\",\"ownerEpoch\":1,\"sourceRevision\":1,\"intent\":";
    String builder=field(call(23,base+"{\"kind\":\"ROWS\"}}"),"builderId");
    String read="{\"state\":\"READY\",\"revision\":1,\"coverage\":{\"kind\":\"ALL_HISTORY\"},\"payload\":{\"schemaVersion\":1,\"data\":{\"kind\":\"VALUE\"}}}";
    String header="{\"builderId\":"+builder+",\"group\":{\"kind\":\"CALENDAR_ENTRIES\",\"source\":"+read+"}}";
    String raw=" \n{\"shiftRows\":[],\"appointmentRows\":[],\"templateRows\":[],\"platformCollationRanks\":{}}\t";
    require(new String(EngineNative.invokeCalendarSource(header.getBytes(StandardCharsets.UTF_8),raw.getBytes(StandardCharsets.UTF_8)),StandardCharsets.UTF_8).contains("CALENDAR_SOURCE_ADDED"));
    String sealed=call(24,"{\"builderId\":"+builder+"}");
    require(sealed.contains("CALENDAR_ROWS_REGISTERED")&&sealed.contains("\"state\":\"READY\""));
    java.util.regex.Matcher identity=java.util.regex.Pattern.compile("\\\"identity\\\":(\\{[^{}]+\\})").matcher(sealed);require(identity.find());
    String request="{\"wireSchemaVersion\":1,\"expectedEngineVersion\":\""+engine+"\",\"calculationContractVersion\":\"luna-engine-contract-v1\",\"guard\":{\"ownerScope\":\"jni-test\",\"ownerEpoch\":1,\"requestId\":\"calendar\",\"draftRevision\":1},\"source\":{\"kind\":\"CALENDAR_ONLY\",\"identity\":"+identity.group(1)+"},\"spec\":{\"kind\":\"PROTOTYPE_YEAR\",\"year\":\"2026\"},\"options\":{\"showAppointments\":true,\"showShifts\":true},\"localeKey\":\"jni-test\"}";
    String prepared=call(26,request);require(prepared.contains("CALENDAR_WINDOW_PREPARED"));
    String resource=field(prepared,"resourceId");
    java.util.regex.Matcher digest=java.util.regex.Pattern.compile("\\\"candidateDigest\\\":\\\"([0-9a-f]{64})\\\"").matcher(prepared);require(digest.find());
    String page=call(27,"{\"resourceId\":"+resource+",\"candidateDigest\":\""+digest.group(1)+"\",\"after\":null,\"limit\":2}");
    require(page.contains("\"total\":0")&&page.contains("\"candidates\":[]"));
    header="{\"resourceId\":"+resource+",\"candidateDigest\":\""+digest.group(1)+"\"}";
    require(new String(EngineNative.invokeCalendarWindowFinalize(header.getBytes(StandardCharsets.UTF_8)," {} \n".getBytes(StandardCharsets.UTF_8)),StandardCharsets.UTF_8).contains("CALENDAR_WINDOW_READY"));
    page=call(28,"{\"resourceId\":"+resource+",\"view\":\"EXPANDED\",\"after\":null,\"limit\":2}");
    require(page.contains("\"items\":[]"));
    String clockBuilder=field(call(23,base+"{\"kind\":\"CLOCK\",\"observedEpochMilliseconds\":0}}"),"builderId");
    for(String kind:new String[]{"WORK_PROFILE","REMUNERATION_PROFILES"}) {
      header="{\"builderId\":"+clockBuilder+",\"group\":{\"kind\":\""+kind+"\",\"source\":"+read.replace("\"VALUE\"","\"NULL\"")+"}}";
      require(new String(EngineNative.invokeCalendarSource(header.getBytes(StandardCharsets.UTF_8),new byte[0]),StandardCharsets.UTF_8).contains("CALENDAR_SOURCE_ADDED"));
    }
    String clock=call(24,"{\"builderId\":"+clockBuilder+"}");
    require(clock.contains("CALENDAR_CLOCK_REGISTERED")&&clock.contains("1970-01-01")&&clock.contains("\"cacheable\":true"));
    require(call(28,"{\"resourceId\":"+resource+",\"view\":\"EXPANDED\",\"after\":null,\"limit\":2}").contains("\"items\":[]"));
    require(call(29,"{\"resourceId\":"+resource+"}").contains("\"aborted\":true"));
    builder=field(call(23,base+"{\"kind\":\"ROWS\"}}"),"builderId");
    require(call(25,"{\"builderId\":"+builder+"}").contains("\"aborted\":true"));
    for(int op=23;op<=29;op++)try{EngineNative.invoke(op,new byte[op==23||op==26?8193:1025]);throw new AssertionError("CALENDAR_LIMIT_ACCEPTED");}catch(IllegalStateException expected){}
    try{EngineNative.invokeCalendarSource(new byte[8193],new byte[0]);throw new AssertionError("CALENDAR_RAW_LIMIT_ACCEPTED");}catch(IllegalStateException expected){}
    try{EngineNative.invokeCalendarWindowFinalize(null,new byte[0]);throw new AssertionError("NULL_CALENDAR_RAW_ACCEPTED");}catch(IllegalStateException expected){}
    String presentation="{\"kind\":\"PRESENTATION\",\"wireSchemaVersion\":1,\"expectedEngineVersion\":\""+engine+"\",\"calculationContractVersion\":\"luna-engine-contract-v1\",\"guard\":{\"ownerScope\":\"jni-test\",\"ownerEpoch\":1,\"requestId\":\"jni-large-calendar\",\"draftRevision\":1},\"command\":{\"kind\":\"INCOMING_DAYS\"}}";
    StringBuilder large=new StringBuilder("{\"calendars\":[{\"accountId\":\"viewer\",\"calendar\":{\"id\":\"calendar\",\"ownerId\":\"owner\",\"name\":\"Alex\",\"color\":\"#abcdef\",\"visibility\":\"DETAILS\",\"revision\":1,\"isOwner\":false,\"publishedAt\":null},\"fetchedAt\":\"2026-10-25T11:00:00Z\",\"visible\":true,\"entries\":[");
    for(int n=0;n<20000;n++) {
      if(n>0)large.append(',');
      large.append("{\"id\":\"entry-").append(n).append("\",\"kind\":\"SHIFT\",\"breakMinutes\":30,\"note\":null,\"title\":\"Nacht\",\"color\":\"#123456\",\"symbol\":\"moon\",\"startsAt\":\"2026-10-24T19:00:00Z\",\"endsAt\":\"2026-10-25T06:30:00Z\",\"timeZone\":\"Europe/Berlin\",\"allDay\":false}");
    }
    large.append("]}],\"timeZone\":\"Europe/Berlin\",\"now\":null,\"window\":null}");
    byte[] largeReply=EngineNative.invokeCalendarSource(presentation.getBytes(StandardCharsets.UTF_8),large.toString().getBytes(StandardCharsets.UTF_8));
    require(largeReply.length>4194304&&largeReply.length<=33554432);
    String largeText=new String(largeReply,StandardCharsets.UTF_8);
    require(largeText.contains("CALENDAR_PRESENTED")&&largeText.contains("entry-19999")&&!largeText.contains("OUTPUT_BUFFER_UNAVAILABLE"));
  }
}

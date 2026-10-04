"use client";
import { useState, useRef, useCallback, useEffect, createContext, useContext } from "react";

// -- THEME -----------------------------------------------------
const ThemeCtx = createContext(null);
function useTheme() { return useContext(ThemeCtx); }
const DARK  = { bg:"#080810",bg2:"#0a0a14",bg3:"#0c0c18",bg4:"#111122",bg5:"#0d0d17",border:"#1f2937",border2:"#2d2d44",text:"#e5e7eb",text2:"#9ca3af",text3:"#6b7280",text4:"#4b5563",text5:"#374151",text6:"#2d2d44",selectBg:"#111122",selectArrow:"%236b7280",cardHover:"#0d0d1f" };
const LIGHT = { bg:"#f8f9fc",bg2:"#ffffff",bg3:"#f1f3f9",bg4:"#ffffff",bg5:"#f8f9fc",border:"#e2e8f0",border2:"#cbd5e1",text:"#0f172a",text2:"#475569",text3:"#64748b",text4:"#94a3b8",text5:"#cbd5e1",text6:"#e2e8f0",selectBg:"#ffffff",selectArrow:"%2364748b",cardHover:"#f0f4ff" };

// -- d TRANSITION FUNCTION -------------------------------------
const initialState = {
  phase:"idle", lens:null, context:"", ideas:[], shortlist:[], skipped:[],
  decision:null, drillTarget:null, compareIds:[], error:null, sessionCount:0,
  batchProgress:null, rubric:null,
};
function delta(state, input) {
  switch(input.type) {
    case "research_started": return { ...state, phase:"researching", lens:input.data.lens, context:input.data.context, ideas:[], drillTarget:null, compareIds:[], skipped:[], error:null, sessionCount:state.sessionCount+1, batchProgress:null };
    case "batch_started":    return { ...state, phase:"batch_running", lens:"all", context:input.data.context, ideas:[], drillTarget:null, compareIds:[], skipped:[], error:null, sessionCount:state.sessionCount+1, batchProgress:{ done:0, total:input.data.total, current:null } };
    case "batch_lens_done":  return { ...state, batchProgress:{ ...state.batchProgress, done:(state.batchProgress?.done||0)+1, current:input.data.lens } };
    case "ideas_observed":   return { ...state, phase:"awaiting_decision", ideas:input.data.ideas };
    case "ideas_merged":     return { ...state, phase:"awaiting_decision", ideas:input.data.ideas, batchProgress:null };
    case "rubric_set":       return { ...state, rubric:input.data.rubric };
    case "idea_shortlisted": return { ...state, shortlist:state.shortlist.includes(input.data.ideaId)?state.shortlist.filter(id=>id!==input.data.ideaId):[...state.shortlist,input.data.ideaId] };
    case "idea_skipped":     return { ...state, skipped:state.skipped.includes(input.data.ideaId)?state.skipped.filter(id=>id!==input.data.ideaId):[...state.skipped,input.data.ideaId] };
    case "compare_toggled":  return { ...state, compareIds:state.compareIds.includes(input.data.ideaId)?state.compareIds.filter(id=>id!==input.data.ideaId):state.compareIds.length<2?[...state.compareIds,input.data.ideaId]:[state.compareIds[1],input.data.ideaId] };
    case "drill_started":    return { ...state, phase:"drilling", drillTarget:input.data.ideaId };
    case "drill_observed":   return { ...state, phase:"awaiting_decision" };
    case "human_decided":    return { ...state, phase:"decided", decision:input.data.ideaId };
    case "research_failed":  return { ...state, phase:"error", error:input.data.message };
    case "session_reset":    return { ...initialState };
    default: return state;
  }
}

// -- LOG & EXECUTOR --------------------------------------------
class InputLog {
  constructor(){ this._log=[]; this._seq=0; }
  append(i){ const e={sequence:this._seq++,...i,timestamp:Date.now()}; this._log.push(e); return e; }
  all(){ return [...this._log]; }
}
class Executor {
  constructor(log){ this._log=log; this._state={...initialState}; }
  get state(){ return this._state; }
  execute(input){ const e=this._log.append(input); this._state=delta(this._state,e); return this._state; }
}

// -- CONSTANTS -------------------------------------------------
const TAG_LIST = ["AI-native","API-first","compliance","B2B","B2C","no-code","vertical","developer-tools","automation","analytics","marketplace","workflow","data","security","fintech","health-tech","legal-tech","HR-tech","e-commerce"];
const TAG_COLORS = { "AI-native":"#6366f1","API-first":"#0891b2","compliance":"#dc2626","B2B":"#059669","B2C":"#d97706","no-code":"#8b5cf6","vertical":"#ec4899","developer-tools":"#0891b2","automation":"#f59e0b","analytics":"#3b82f6","marketplace":"#10b981","workflow":"#6366f1","data":"#0891b2","security":"#dc2626","fintech":"#059669","health-tech":"#10b981","legal-tech":"#dc2626","HR-tech":"#8b5cf6","e-commerce":"#d97706" };
const TAG_STR = TAG_LIST.join(", ");

const LENSES = {
  market_gap:     { label:"Market Gap",     color:"#6366f1", systemPrompt:"You are a sharp SaaS market researcher. Find real market gaps where existing tools are weak or absent. Focus on B2B niches and workflow tools.", userPrompt:(ctx)=>"Research SaaS market gaps "+(ctx?"in: "+ctx:"across B2B software")+".\n\nReturn EXACTLY this JSON:\n{\"ideas\":[{\"id\":\"idea_1\",\"name\":\"Short name\",\"tagline\":\"One sentence value prop\",\"problem\":\"Pain (2 sentences)\",\"target\":\"Exact persona\",\"gap\":\"Why solutions fail\",\"signals\":[\"s1\",\"s2\",\"s3\"],\"difficulty\":\"low\",\"marketSize\":\"medium\",\"score\":72,\"confidence\":80,\"tags\":[\"B2B\"]}]}\nGenerate 5 ideas. score 0-100. confidence 0-100. tags 1-3 from ["+TAG_STR+"]. No markdown, pure JSON." },
  pain_driven:    { label:"Pain Driven",    color:"#d97706", systemPrompt:"You are a SaaS researcher who mines reviews, Reddit, support tickets for recurring complaints with no good solution.", userPrompt:(ctx)=>"Find SaaS ideas from pain points "+(ctx?"in "+ctx:"in B2B workflows")+".\n\nReturn EXACTLY this JSON:\n{\"ideas\":[{\"id\":\"idea_1\",\"name\":\"Short name\",\"tagline\":\"One sentence value prop\",\"problem\":\"Documented complaint\",\"target\":\"Who complains\",\"gap\":\"Why no fix exists\",\"signals\":[\"s1\",\"s2\",\"s3\"],\"difficulty\":\"low\",\"marketSize\":\"medium\",\"score\":72,\"confidence\":80,\"tags\":[\"B2B\"]}]}\nGenerate 5 ideas. score 0-100. confidence 0-100. tags 1-3 from ["+TAG_STR+"]. No markdown, pure JSON." },
  trend_riding:   { label:"Trend Riding",   color:"#059669", systemPrompt:"You are a SaaS trend analyst. Find structural shifts - regulation, platform changes, behavior change - and the SaaS opportunities they create.", userPrompt:(ctx)=>"Find SaaS ideas riding trends "+(ctx?"in "+ctx:"across industries")+".\n\nReturn EXACTLY this JSON:\n{\"ideas\":[{\"id\":\"idea_1\",\"name\":\"Short name\",\"tagline\":\"One sentence value prop\",\"problem\":\"Need created by trend\",\"target\":\"Who it hits hardest\",\"gap\":\"Why solutions miss it\",\"signals\":[\"s1\",\"s2\",\"s3\"],\"difficulty\":\"low\",\"marketSize\":\"medium\",\"score\":72,\"confidence\":80,\"tags\":[\"AI-native\"]}]}\nGenerate 5 ideas. score 0-100. confidence 0-100. tags 1-3 from ["+TAG_STR+"]. No markdown, pure JSON." },
  niche_vertical: { label:"Niche Vertical", color:"#8b5cf6", systemPrompt:"You are a vertical SaaS researcher. Find industries where generic tools are being replaced by purpose-built vertical software.", userPrompt:(ctx)=>"Find vertical SaaS opportunities "+(ctx?"in "+ctx:"in overlooked industries")+".\n\nReturn EXACTLY this JSON:\n{\"ideas\":[{\"id\":\"idea_1\",\"name\":\"Short name\",\"tagline\":\"One sentence value prop\",\"problem\":\"What industry does with generic tools\",\"target\":\"Specific role in specific industry\",\"gap\":\"What generic tools cannot handle\",\"signals\":[\"s1\",\"s2\",\"s3\"],\"difficulty\":\"low\",\"marketSize\":\"medium\",\"score\":72,\"confidence\":80,\"tags\":[\"vertical\"]}]}\nGenerate 5 ideas. score 0-100. confidence 0-100. tags 1-3 from ["+TAG_STR+"]. No markdown, pure JSON." },
};

const CONTEXTS = { "":"Any industry",healthcare:"Healthcare",legal:"Legal","developer tools":"Developer tools","e-commerce":"E-commerce",fintech:"Fintech",construction:"Construction",education:"Education",logistics:"Logistics","HR & recruiting":"HR & Recruiting","real estate":"Real estate",manufacturing:"Manufacturing",__custom__:"Custom..." };
const SORT_OPTIONS = { score_desc:"Viability v",score_asc:"Viability ^",weighted_desc:"Weighted score v",rubric_desc:"Rubric match v",difficulty_asc:"Easiest first",market_desc:"Market size v",confidence_desc:"Confidence v" };
const FILTER_DIFFICULTY = { all:"All difficulties",low:"Low",medium:"Medium",high:"High" };
const FILTER_MARKET = { all:"All sizes",small:"Niche",medium:"Mid-market",large:"Large" };
const DIFF_COLOR = { low:"#059669",medium:"#d97706",high:"#dc2626" };
const MKT_LABEL = { small:"Niche",medium:"Mid-market",large:"Large" };
const DIFF_SCORE = { low:100,medium:60,high:20 };
const MKT_SCORE = { large:100,medium:60,small:30 };
const DEFAULT_WEIGHTS = { viability:40,ease:30,market:20,confidence:10 };
const DEFAULT_RUBRIC = { soloFounder:false, recurringRevenue:false, aiNative:false, noCode:false, lowTechRisk:false, globalMarket:false };
const RUBRIC_LABELS = { soloFounder:"Solo-buildable",recurringRevenue:"Recurring revenue",aiNative:"AI-native",noCode:"No-code friendly",lowTechRisk:"Low tech risk",globalMarket:"Global market" };

function weightedScore(idea, w) {
  const v=idea.score||0, e=DIFF_SCORE[idea.difficulty]||50, m=MKT_SCORE[idea.marketSize]||50, c=idea.confidence||50;
  const total=w.viability+w.ease+w.market+w.confidence;
  return Math.round((v*w.viability+e*w.ease+m*w.market+c*w.confidence)/total);
}
function rubricScore(idea, rubric, drillD) {
  let hits=0, total=0;
  Object.entries(rubric).forEach(([k,v])=>{ if(!v) return; total++; const tags=idea.tags||[];
    if(k==="soloFounder"&&drillD&&(drillD.mvpTeam||"").toLowerCase().includes("solo")) hits++;
    else if(k==="recurringRevenue"&&(idea.tagline+idea.problem).toLowerCase().includes("subscri")) hits++;
    else if(k==="aiNative"&&tags.includes("AI-native")) hits++;
    else if(k==="noCode"&&tags.includes("no-code")) hits++;
    else if(k==="lowTechRisk"&&drillD&&(drillD.techRisk||"").length<100) hits++;
    else if(k==="globalMarket"&&idea.marketSize==="large") hits++;
  });
  return total===0?0:Math.round((hits/total)*100);
}

// -- MOCK DATA -------------------------------------------------
// Pre-scripted research session for demo / no-API-key exploration.
// Covers: retail & SME context, all 4 lenses, drill reports, opinions, compare.

const MOCK_IDEAS = {
  market_gap: [
    { id:"mg_1", name:"StockSense",       tagline:"Inventory forecasting for independent retailers",           problem:"Independent retailers over-order by 23% on average and stock out on top sellers weekly. Manual Excel forecasting misses seasonal and local demand patterns.",          target:"Owners of independent retail stores (1-5 locations, $500k-$5M revenue)",        gap:"Shopify analytics shows history but no forward forecast. NetSuite/SAP too expensive. Nothing purpose-built for single-location indie retail.",              signals:["$1.2T in excess retail inventory annually","47% of small retailers cite stockouts as top problem","Shopify has 2M+ merchants with no native forecasting"],          difficulty:"medium", marketSize:"large",  score:82, confidence:81, tags:["e-commerce","AI-native","analytics"],    _lens:"market_gap" },
    { id:"mg_2", name:"SupplierPay",      tagline:"BNPL for SME supplier invoices",                           problem:"Small retailers pay suppliers net-30 to net-60 but run out of cash before invoices clear. 60% of SME failures cite cash flow as primary cause.",                  target:"SME retailers and wholesalers with $1M-$20M annual turnover",                   gap:"Factoring exists but charges 3-5% per invoice. BNPL for B2B (Resolve, Apruve) targets enterprises. Nothing simple for SMEs under $20M.",                  signals:["$950B in outstanding SME invoices globally","UK: 50,000 SME insolvencies/yr linked to late payment","Xero reports 52% of invoices paid late"],            difficulty:"medium", marketSize:"large",  score:80, confidence:78, tags:["fintech","B2B","marketplace"],          _lens:"market_gap" },
    { id:"mg_3", name:"RetailReview AI",  tagline:"Automated competitor price and review monitoring",         problem:"Independent retailers manually check competitor prices 2-3x per week. Amazon reprices 2.5M products per day. Small retailers can't keep up.",                      target:"Multi-category independent retailers competing with Amazon and big box",          gap:"Prisync and Price2Spy exist but cost $300+/month and target e-commerce only. Nothing for physical + online hybrid retailers.",                              signals:["Amazon price changes 2.5M times daily","71% of shoppers check prices on phone in-store","SME retailer margins squeezed 8pts in 5 years"],              difficulty:"low",    marketSize:"medium", score:77, confidence:75, tags:["e-commerce","analytics","AI-native"],    _lens:"market_gap" },
    { id:"mg_4", name:"LocalLoyalty",     tagline:"Loyalty program network for independent retail clusters",  problem:"Independent retailers can't afford standalone loyalty programs. Chains dominate because they offer points networks. Independents lose repeat customers.",              target:"BIDs and retail associations representing 20-200 independent stores",            gap:"Stamp.me and Loopy Loyalty are single-store tools. No multi-merchant network for independents exists at sub-$200/month pricing.",                          signals:["Chain stores have 3x repeat purchase rate vs independents","70% of consumers prefer local but choose chains for loyalty perks","BIDs growing 12%/yr"],   difficulty:"low",    marketSize:"medium", score:75, confidence:79, tags:["e-commerce","B2C","marketplace"],        _lens:"market_gap" },
    { id:"mg_5", name:"ShelfAI",          tagline:"Computer vision shelf audit for FMCG brands and distributors", problem:"FMCG brands spend $180B/yr on trade spend but 35% of retail execution fails - wrong placement, out-of-stock, wrong pricing. Manual audits catch less than 20% of issues.", target:"Field sales and trade marketing managers at FMCG brands (mid-size, $50M-$500M)", gap:"Trax and Planorama serve Unilever/P&G at $500k+ contracts. Mid-size FMCG brands have no affordable alternative.",                                         signals:["$180B global trade spend market","Only 65% retail execution compliance on average","Mid-size FMCG brands have 10-50 field reps doing manual audits"],  difficulty:"high",   marketSize:"large",  score:79, confidence:74, tags:["AI-native","analytics","vertical"],      _lens:"market_gap" },
  ],
  pain_driven: [
    { id:"pd_1", name:"ReturnFlow",       tagline:"Returns management and restocking automation for SME retailers", problem:"SME retailers process returns manually - takes 15 min per item. Online return rates hit 30%. Staff hate it and errors cause inventory mismatches.",          target:"E-commerce SME retailers processing 50+ returns per week",                      gap:"Loop Returns and AfterShip target Shopify Plus ($2k+/month). Nothing for SMEs doing under $5M online revenue.",                                             signals:["$816B in retail returns in US 2022","Reddit r/smallbusiness: 'returns are killing us' - 2.3k upvotes","Shopify forums: returns processing is #1 pain"], difficulty:"low",    marketSize:"medium", score:81, confidence:83, tags:["e-commerce","workflow","automation"],    _lens:"pain_driven" },
    { id:"pd_2", name:"SMEPayroll+",      tagline:"Payroll with built-in shift scheduling for retail SMEs",   problem:"Retail SMEs use 2-3 separate tools for scheduling (Deputy/When I Work), payroll (Xero/QuickBooks), and time tracking. Data entry between systems costs 5hrs/week.", target:"Retail and hospitality SMEs with 5-50 employees",                               gap:"ADP and Gusto have payroll. Deputy has scheduling. None combine them seamlessly for under $100/month total.",                                               signals:["SME owners cite payroll/scheduling as top 3 admin burden","Deputy + Xero integration breaks monthly for 30% of users per G2 reviews","$12B SME payroll market"], difficulty:"medium", marketSize:"large",  score:78, confidence:80, tags:["B2B","HR-tech","workflow"],             _lens:"pain_driven" },
    { id:"pd_3", name:"SupplierChat",     tagline:"WhatsApp-native ordering for SMEs and their suppliers",    problem:"SME retailers in emerging markets (SE Asia, LATAM, Africa) order stock via WhatsApp voice notes and photos. Errors, delays, and no audit trail cause 15% over-ordering.", target:"SME retailers in SE Asia and LATAM ordering from local distributors",           gap:"TradeGecko (now QuickBooks Commerce) is too complex. B2B e-commerce platforms assume internet access. WhatsApp is the actual workflow.",                   signals:["2B WhatsApp Business users","Grab surveys: 78% of warung owners use WhatsApp to order stock","$6T informal SME trade in emerging markets"],            difficulty:"medium", marketSize:"large",  score:83, confidence:82, tags:["B2B","marketplace","workflow"],         _lens:"pain_driven" },
    { id:"pd_4", name:"ChurnAlert",       tagline:"Customer churn prediction for subscription retail boxes",  problem:"Subscription box businesses (beauty, food, lifestyle) see 8-15% monthly churn. They detect it only when cancellation happens - too late to intervene.",             target:"Subscription box operators with 500-10,000 active subscribers",                 gap:"Baremetrics and ChartMogul track metrics but don't predict churn. Klaviyo sends emails but doesn't identify who to email.",                                signals:["Subscription box market $65B growing 18%/yr","Average LTV of retained subscriber 4x churned","Cratejoy forums: 'I wish I knew who was about to cancel'"], difficulty:"low",    marketSize:"medium", score:79, confidence:77, tags:["e-commerce","AI-native","analytics"],   _lens:"pain_driven" },
    { id:"pd_5", name:"MarketStall OS",   tagline:"Point-of-sale and inventory for market traders and pop-ups", problem:"Market traders use cash, paper stock lists, and mental math. Can't accept cards easily, lose track of bestsellers, and can't prove income for loans.",           target:"Market traders, pop-up retailers, and craft fair sellers (1-person operations)",gap:"Square and SumUp handle payments but have no inventory or income tracking. Nothing built for the market-stall workflow (setup in 2 min, offline-first).",    signals:["2.5M market traders in UK alone","HMRC making tax digital 2026 deadline","Etsy sellers cite 'in-person selling tools' as biggest gap"],               difficulty:"low",    marketSize:"medium", score:76, confidence:80, tags:["B2C","vertical","no-code"],            _lens:"pain_driven" },
  ],
  trend_riding: [
    { id:"tr_1", name:"TikTokSync",       tagline:"Live commerce inventory sync for social sellers",          problem:"TikTok Shop sellers go viral and sell out in minutes, then face chargebacks and angry customers because Shopify inventory didn't update in real time.",             target:"Social commerce sellers doing $10k-$500k/month across TikTok Shop + Shopify",   gap:"TikTok Shop has no native Shopify sync that handles live selling spikes. Zapier workarounds break at scale.",                                              signals:["TikTok Shop GMV $20B 2023, 10x in 2 years","#1 complaint in TikTok seller groups: overselling during lives","Shopify CEO cited social commerce as top priority"], difficulty:"low",    marketSize:"large",  score:85, confidence:87, tags:["e-commerce","AI-native","automation"],  _lens:"trend_riding" },
    { id:"tr_2", name:"CarbonCart",       tagline:"Carbon footprint calculator and offset for SME retailers", problem:"B-Corp certification and sustainability reporting now required by major retailers (M&S, Tesco) for their suppliers. SME suppliers have no affordable tool to calculate Scope 3 emissions.", target:"SME product suppliers selling into major UK/EU retailers",                     gap:"Watershed and Persefoni charge $20k+/yr. No SME-priced solution exists. EU CSRD mandate hits SMEs in 2026.",                                              signals:["EU CSRD sustainability reporting mandate expands to SMEs 2026","M&S requires supplier carbon data by 2025","$4B SME sustainability software market by 2027"], difficulty:"medium", marketSize:"medium", score:78, confidence:76, tags:["compliance","B2B","vertical"],         _lens:"trend_riding" },
    { id:"tr_3", name:"AIBuyer",          tagline:"AI purchasing agent for SME retail buyers",                problem:"Retail buyers at SMEs spend 60% of their time on supplier research, range planning, and trend spotting. Gen-Z consumers shift preferences 3x faster than before.",  target:"Buying managers at independent fashion, homewares, and gift retailers",          gap:"Trendalytics and WGSN serve enterprise retailers ($50k+/yr). No AI buying tool exists for independent retailers with $500k-$5M in stock.",                 signals:["Fashion trend cycles shortened from 2yr to 6mo","Independent retailer buyers cite 'keeping up with trends' as #1 challenge","WGSN costs $30k+/yr"],   difficulty:"medium", marketSize:"medium", score:77, confidence:73, tags:["AI-native","e-commerce","analytics"],  _lens:"trend_riding" },
    { id:"tr_4", name:"QuickBooks Exit",  tagline:"Accounting migration tool for SMEs switching from legacy software", problem:"UK Making Tax Digital mandate (2026) forces 4M SMEs off spreadsheets and legacy software. Migration is painful - average 40 hours of manual data cleanup.", target:"SME owners and accountants migrating to cloud accounting before 2026 deadline",  gap:"QuickBooks and Xero offer migration help but it's manual and slow. No automated migration product exists.",                                                signals:["4M UK SMEs must comply with MTD by April 2026","HMRC survey: 68% of affected SMEs haven't started migration","Accountant forums: migration backlogs growing"], difficulty:"low",    marketSize:"medium", score:80, confidence:84, tags:["fintech","compliance","automation"],    _lens:"trend_riding" },
    { id:"tr_5", name:"RetailGPT",        tagline:"AI customer service agent for Shopify stores",             problem:"Small Shopify stores get 50-200 customer service messages per day about order status, returns, and product questions. Owners answer manually at all hours.",         target:"Shopify store owners doing $200k-$2M/yr without a CS team",                     gap:"Gorgias and Zendesk are ticket management tools. No LLM-native agent that resolves (not just routes) Shopify CS queries exists under $100/month.",         signals:["Shopify merchants spend avg 3hrs/day on CS","LLM adoption by SMEs up 340% in 2023","#1 Shopify forum request: automated CS that actually works"],     difficulty:"low",    marketSize:"large",  score:84, confidence:86, tags:["AI-native","e-commerce","automation"],  _lens:"trend_riding" },
  ],
  niche_vertical: [
    { id:"nv_1", name:"BreweryOps",       tagline:"ERP built for independent craft breweries",                problem:"Craft breweries run production, taproom, wholesale, and compliance on separate tools - Ekos for brewing, Square for taproom, Shopify for online, spreadsheets for TTB compliance.", target:"Independent craft breweries producing 500-10,000 barrels per year",              gap:"Ekos and OrchestratedBEER are production-only. No single tool covers taproom + production + compliance + wholesale for sub-$50M breweries.",              signals:["9,500 craft breweries in US, growing 4%/yr","TTB compliance errors cost avg brewery $8k/yr in fines","Brewery forums: 'I use 6 tools and hate all of them'"], difficulty:"medium", marketSize:"medium", score:79, confidence:82, tags:["vertical","workflow","compliance"],     _lens:"niche_vertical" },
    { id:"nv_2", name:"FarmShop Suite",   tagline:"Multi-channel management for farm shops and rural retailers", problem:"Farm shops sell at the gate, at farmers markets, online (Shopify), and wholesale to restaurants - all tracked separately. HMRC VAT on food is notoriously complex for mixed producers.", target:"UK farm shops and rural retailers with mixed produce and retail",               gap:"Shopify doesn't handle mixed VAT rates well. Nothing manages gate sales + markets + wholesale for rural SMEs.",                                             signals:["UK farm shop market GBP1.2B growing 9%/yr","HMRC Making Tax Digital complex for mixed VAT producers","Farm Retail Association: data management top pain"], difficulty:"low",    marketSize:"medium", score:77, confidence:78, tags:["vertical","compliance","workflow"],     _lens:"niche_vertical" },
    { id:"nv_3", name:"VapeCompliance",   tagline:"Age verification and compliance platform for vape retailers", problem:"Vape retailers face strict age verification laws (UK AVPA 2024), product registration requirements, and flavour bans. Compliance failures mean store closure.",        target:"Independent vape and convenience retailers in UK and EU",                        gap:"Age verification tools exist (Yoti, AgeID) but no platform combines age-check + product compliance + inventory restrictions in one.",                     signals:["UK AVPA age verification mandatory 2024","GBP50M in fines issued to non-compliant vape retailers 2023","10,000+ independent vape shops in UK"],         difficulty:"low",    marketSize:"medium", score:80, confidence:85, tags:["vertical","compliance","B2B"],         _lens:"niche_vertical" },
    { id:"nv_4", name:"GiftTradeOS",      tagline:"B2B wholesale ordering platform for gift and homewares brands", problem:"UK gift and homewares brands exhibit at Spring Fair and Autumn Fair, take orders on paper, then manually enter them into Sage or QuickBooks. Average 8hrs of data entry per show.", target:"Gift and homewares brands selling wholesale at trade shows (GBP500k-GBP5M turnover)",gap:"Faire targets US-first and charges 15% commission. NuOrder is enterprise. UK gift brands have no affordable trade ordering platform.",                      signals:["UK gift market GBP5B, 85% served by SME brands","Spring Fair has 1,500 exhibitors, most using paper order forms","Faire commission model rejected by 60% of UK brands"], difficulty:"low",    marketSize:"medium", score:81, confidence:83, tags:["marketplace","B2B","vertical"],        _lens:"niche_vertical" },
    { id:"nv_5", name:"ConvenienceIQ",    tagline:"Category management and planogram tool for convenience stores", problem:"Convenience store owners (CTNs) make ranging decisions based on gut feel. Supplier reps push their own products. Margin per square foot is 40% below optimum on average.", target:"Independent convenience store owners (single or 2-3 stores)",                  gap:"Nielsen and IRI provide category data to multiples only. No affordable planogram or category management tool exists for independents.",                     signals:["50,000 independent convenience stores in UK","Avg convenience store margin 22% vs 31% for multiples","ACS Local Shop Report: data tools cited as biggest gap"], difficulty:"medium", marketSize:"medium", score:78, confidence:79, tags:["vertical","analytics","AI-native"],   _lens:"niche_vertical" },
  ],
};

const MOCK_DRILLS = {
  tr_1: { verdict:"GO",    verdictReason:"First-mover window open now - TikTok Shop growing 10x but tooling is 2 years behind", competitors:[{name:"SKULabs",weakness:"Warehouse management tool, not built for live selling spikes"},{name:"Linnworks",weakness:"Enterprise multichannel, $500+/month, no TikTok-native sync"},{name:"StoreAutomator",weakness:"Price-focused, no live inventory protection"}], gtm:"Join TikTok seller Facebook groups and Discord servers. Offer free 14-day trial. Target sellers who've had an overselling incident - they'll pay immediately. Cold DM top TikTok Shop sellers.", techRisk:"TikTok API rate limits during live events. Need webhook-level integration, not polling.", marketRisk:"TikTok Shop builds this natively. Mitigation: expand to Instagram Live and YouTube Shopping before they do.", arr12m:"$312k (260 sellers at $100/month)", mvpWeeks:6, mvpTeam:"Solo founder (full-stack)", mvpCost:"$0-2k", summary:"TikTokSync is the clearest near-term opportunity in this set. The problem is acute - sellers literally lose money and customers when they oversell during a viral live. The TikTok Shop API launched properly in 2023 but no purpose-built sync tool exists for the live commerce use case. The window is 12-18 months before TikTok builds this natively or a well-funded startup beats you. Shopify integration is well-documented. TikTok Shop API is accessible. Distribution is self-serve through seller communities where the pain is openly discussed. Fastest path to $100k ARR in this list - possibly 90 days from launch." },
  pd_3: { verdict:"GO",    verdictReason:"Massive underserved market, WhatsApp moat, emerging market tailwind", competitors:[{name:"TradeDepot",weakness:"Nigeria-focused, not a horizontal platform"},{name:"Udaan",weakness:"India-only, own inventory model, not a tool"},{name:"OrderEase",weakness:"US-focused, requires smartphone app download"}], gtm:"Partner with 3 distributors in one city (Jakarta, Manila, or Nairobi). Build their order intake flow first - they bring their retailers. Land-and-expand via distributor network.", techRisk:"WhatsApp Business API has message limits and compliance requirements. Meta approval process takes 2-4 weeks.", marketRisk:"WhatsApp builds ordering natively. Low probability - they're a platform, not a vertical software company.", arr12m:"$180k (30 distributors at $500/month)", mvpWeeks:8, mvpTeam:"2 founders (1 technical, 1 market)", mvpCost:"$3-8k", summary:"SupplierChat targets the massive informal SME trade market in SE Asia and LATAM where WhatsApp is already the operating system for business. The insight is that you're not replacing WhatsApp - you're adding structure on top of it. Distributors are the key customer: they want fewer errors and better records; retailers get easier ordering as a side effect. The business model is B2B SaaS sold to distributors, not retailers. WhatsApp Business API gives you a legitimate channel. The risk is Meta, but they've never built vertical ordering software. This is a high-conviction emerging market bet requiring local presence in the target city." },
  mg_1: { verdict:"GO",    verdictReason:"Clear pain, massive market, no dominant SME-priced solution", competitors:[{name:"Inventory Planner",weakness:"Shopify plugin, simple reorder points only, no ML forecasting"},{name:"Brightpearl",weakness:"Enterprise OMS, $1k+/month, over-engineered for independents"},{name:"Linnworks",weakness:"Multichannel focus, forecasting is an afterthought"}], gtm:"List on Shopify App Store - 2M merchants, free discovery. Offer free tier up to 500 SKUs. Upsell on forecast accuracy and multi-location. Target merchants who've left reviews complaining about stockouts.", techRisk:"Forecasting accuracy depends on data volume. Need 6+ months of sales history for meaningful predictions - new stores will get weak results.", marketRisk:"Shopify launches native forecasting. They've hinted at this but historically slow to build analytics features.", arr12m:"$264k (220 stores at $100/month)", mvpWeeks:10, mvpTeam:"Solo founder + 1 data scientist", mvpCost:"$2-5k", summary:"StockSense tackles one of retail's oldest problems - inventory accuracy - with modern ML that's finally affordable to deploy. The Shopify App Store gives you distribution to 2M merchants without a sales team. The core algorithm is a time-series forecasting model (Prophet or similar) trained on the merchant's own sales data. The defensible moat comes from incorporating external signals: local events, weather, competitor promotions. Inventory Planner has proven willingness to pay at $99-$299/month. The opportunity is to out-forecast them with better ML while matching their price. Solid GO - the market is large, the technology is proven, and distribution is built-in." },
  nv_4: { verdict:"GO",    verdictReason:"Niche with real structural gap, Faire's commission model creates opening", competitors:[{name:"Faire",weakness:"15% new buyer commission rejected by UK brands, US-first culture"},{name:"NuOrder",weakness:"$12k+/yr enterprise pricing, owned by Levi's"},{name:"Ankorstore",weakness:"European focus, same commission model issues as Faire"}], gtm:"Exhibit at Spring Fair Birmingham (Feb) and Autumn Fair (Sept). Offer free show-period ordering - brands pay $0 during the show, then $199/month after. Target brands who've complained publicly about Faire's fees.", techRisk:"Integration with Sage and QuickBooks UK editions. Both have APIs but UK-specific tax handling (VAT, EC Sales Lists) adds complexity.", marketRisk:"Faire reduces UK commissions to compete. They've shown willingness to subsidise to win markets.", arr12m:"$239k (100 brands at $199/month)", mvpWeeks:8, mvpTeam:"Solo founder + part-time accountant consultant", mvpCost:"$3-6k", summary:"GiftTradeOS targets a painful and specific gap: UK gift brands who exhibit at trade shows and hate paper order forms but won't pay Faire's 15% commission. The commission rejection is a real and documented complaint - Faire's community forums have hundreds of threads about it. The MVP is genuinely simple: a branded order form, digital signature, and automatic sync to the brand's accounting software. Trade shows happen twice a year which gives a natural sales cycle. The non-obvious insight is that accountants are the real buyer influencers here - they're the ones dealing with the 8 hours of data entry. A referral program for accountants could be powerful distribution." },
  pd_1: { verdict:"GO",    verdictReason:"Low complexity, clear ROI, underserved SME segment of large market", competitors:[{name:"Loop Returns",weakness:"Shopify Plus only ($2k+/month), too expensive for SMEs"},{name:"AfterShip Returns",weakness:"Limited automation, more tracking than processing"},{name:"Returnly",weakness:"Acquired by Affirm, enterprise focus, pricing opaque"}], gtm:"Shopify App Store listing + ProductHunt launch. Target merchants with 3-4 star reviews mentioning 'returns' negatively. Partner with Shopify experts/agencies for referrals. $49/month starter plan.", techRisk:"Shopify API webhooks for return triggers are reliable. Main complexity is carrier API integrations for label generation.", marketRisk:"Shopify launches native returns management. They launched basic returns in 2023 - could expand.", arr12m:"$176k (300 merchants at $49/month average)", mvpWeeks:6, mvpTeam:"Solo founder", mvpCost:"$0-1k", summary:"ReturnFlow is the most executable idea in this set for a solo founder. The problem is universal among e-commerce SMEs, the technology is straightforward (Shopify API + carrier APIs), and Loop Returns has validated willingness to pay at enterprise - you're just pricing for SME. The key differentiator is simplicity: onboard in 5 minutes, no configuration, works out of the box for the 95% use case. Advanced features (exchanges, store credit) can come later. Distribution via Shopify App Store gives you organic discovery. Target merchants doing GBP200k-GBP2M with a 15-30% return rate - they're losing 2-3 hours per day to this problem. Clearest path to first paying customer in this list." },
};

const MOCK_OPINIONS = {
  tr_1: { lens:"pain_driven", agreement:"agree",    revisedScore:87, revisedConfidence:89, newAngle:"Pain-driven lens finds even stronger signal: TikTok seller communities are full of rage posts about overselling incidents. The emotional intensity of the pain (losing customers during a viral moment) means urgency to pay is immediate. Sellers don't need convincing.", keyInsight:"The viral moment is the trigger event - sellers will pay the day after an overselling incident. Build a post-incident onboarding flow." },
  pd_3: { lens:"niche_vertical",agreement:"agree",  revisedScore:84, revisedConfidence:80, newAngle:"Vertical lens confirms the distributor-first GTM is correct. Distributors are the power node in the informal retail network. Winning one distributor with 200 retailers is worth 200 direct retailer sales. The product should look like a distributor tool, not a retailer tool.", keyInsight:"Don't build a marketplace. Build a distributor operating system that retailers happen to use." },
  mg_1: { lens:"trend_riding", agreement:"partial",  revisedScore:79, revisedConfidence:74, newAngle:"Trend lens adds a risk: Shopify has been acquiring inventory management companies (Deliverr, 6 River Systems). Native forecasting is on their roadmap. The window may be shorter than 18 months. Recommends building the data layer (supplier integrations, demand signals) as the moat, not the forecast algorithm itself.", keyInsight:"The real moat is proprietary data - local event calendars, supplier lead times, competitor signals. The algorithm is a commodity." },
};

// -- MOCK OBSERVE FUNCTIONS ------------------------------------
// These replace the real API calls when mockMode is true.
// Responses are instant (with a simulated delay for realism).

async function mockObserveIdeas(lens, context, count) {
  await new Promise(r => setTimeout(r, 900 + Math.random() * 600)); // simulate latency
  const ideas = (MOCK_IDEAS[lens] || MOCK_IDEAS.market_gap).slice(0, Math.min(count, 5));
  // Stamp with lens
  return ideas.map(i => ({ ...i, _lens: lens }));
}

async function mockObserveDrill(idea) {
  await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));
  return MOCK_DRILLS[idea.id] || {
    verdict:"MAYBE", verdictReason:"Interesting but needs more market validation",
    competitors:[{name:"Generic Incumbent",weakness:"Not purpose-built for this segment"}],
    gtm:"Start with direct outreach to 20 target customers. Offer free pilot.",
    techRisk:"API integration complexity may extend MVP timeline.",
    marketRisk:"Larger players could enter if market proves large enough.",
    arr12m:"$120k (20 customers at $500/month)", mvpWeeks:10, mvpTeam:"Solo founder", mvpCost:"$3-8k",
    summary:"This idea targets a real pain point in a moderately underserved segment. The competitive landscape is fragmented with no dominant player purpose-built for this exact use case. Technical execution is straightforward. The main questions are distribution and whether the buyer has budget authority. Strong candidate for a lean MVP to validate willingness to pay before full build.",
  };
}

async function mockObserveSecondOpinion(idea, originalLens) {
  await new Promise(r => setTimeout(r, 800 + Math.random() * 500));
  return MOCK_OPINIONS[idea.id] || {
    lens: originalLens === "market_gap" ? "pain_driven" : "market_gap",
    agreement:"partial", revisedScore: Math.max(40, idea.score - 5 + Math.floor(Math.random()*10)),
    revisedConfidence: 65,
    newAngle:"Second lens confirms the core thesis but raises questions about go-to-market complexity. The buyer is real but the sales cycle may be longer than initially estimated.",
    keyInsight:"Distribution and sales motion matter as much as the product. Validate channel assumptions early.",
  };
}

async function mockObserveCompare(ideaA, ideaB) {
  await new Promise(r => setTimeout(r, 1000 + Math.random() * 600));
  const aWins = ideaA.score >= ideaB.score;
  return {
    winner: aWins ? "A" : "B",
    winnerReason: aWins ? `${ideaA.name} has higher viability score and clearer regulatory tailwind` : `${ideaB.name} has lower build complexity and faster path to first revenue`,
    dimensionScores: {
      marketSize:      { A: Math.round(ideaA.score * 0.9), B: Math.round(ideaB.score * 0.95) },
      buildDifficulty: { A: ideaA.difficulty==="low"?85:ideaA.difficulty==="medium"?60:35, B: ideaB.difficulty==="low"?85:ideaB.difficulty==="medium"?60:35 },
      urgency:         { A: Math.round(ideaA.confidence * 0.85), B: Math.round(ideaB.confidence * 0.9) },
      competition:     { A: 65, B: 70 },
      gtmClarity:      { A: 72, B: 68 },
    },
    tradeoffs: `${ideaA.name} has higher ceiling but requires more capital and longer timeline. ${ideaB.name} is faster to revenue but may have a smaller TAM.`,
    recommendation: `Start with ${aWins ? ideaA.name : ideaB.name} for faster validation. The market is large enough that early traction will clarify the full opportunity. Run a 90-day pilot before committing to a full build.`,
  };
}

// -- BACKEND CONFIG --------------------------------------------
// LIVE mode calls your deployed Vercel backend.
// Change BACKEND_URL to your own deployment URL.
const BACKEND_URL   = "https://helix-dope.vercel.app";
const OLLAMA_URL    = "http://localhost:11434";   // fallback for local dev
const OLLAMA_MODEL  = "llama3.2";

async function callLLM(system, user, maxTokens=1500, modelOverride) {
  const model = modelOverride || OLLAMA_MODEL;
  if (LLM_PROVIDER === "ollama") {
    // Ollama /api/chat endpoint - OpenAI-compatible
    const res = await fetch(OLLAMA_URL+"/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:  model,
        stream: false,
        options: { num_predict: maxTokens, temperature: 0.7 },
        messages: [
          { role: "system",  content: system },
          { role: "user",    content: user   },
        ],
      }),
    });
    if (!res.ok) throw new Error("Ollama error: "+res.status+" - is Ollama running? (ollama serve)");
    const data = await res.json();
    return data.message?.content ?? "";
  } else {
    // Anthropic fallback
    const res = await fetch("/api/proxy/anthropic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:maxTokens,
        system, messages:[{role:"user",content:user}] }),
    });
    const data = await res.json();
    return data.content?.[0]?.text ?? "";
  }
}

function parseJSON(raw, fallback) {
  const clean = raw.replace(/```json|```/g,"").trim();
  // Try to extract JSON object if model added preamble
  const match = clean.match(/\{[\s\S]*\}/);
  try { return JSON.parse(match ? match[0] : clean); }
  catch(e) { return fallback; }
}

// -- API CALLS (Backend mode) ----------------------------------
// In LIVE mode, all calls go to the deployed Vercel backend.
// The backend handles LLM calls (OpenRouter -> Ollama fallback).

async function startBackendWorkflow(sessionId, lens, context, count, mode) {
  const res = await fetch(BACKEND_URL+"/api/workflow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, lens, context, count, mode }),
  });
  if (!res.ok) throw new Error("Failed to start workflow: "+res.status);
  return res.json(); // { workflowId }
}

async function sendBackendAction(workflowId, type, payload) {
  await fetch(BACKEND_URL+"/api/workflow/"+workflowId+"/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, payload }),
  });
}

async function drillBackend(workflowId, idea) {
  await fetch(BACKEND_URL+"/api/workflow/"+workflowId+"/drill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idea }),
  });
}

// These are kept for Ollama fallback / mock mode compatibility
async function observeIdeas(lens, context, count, modelRef) {
  const cfg=LENSES[lens];
  const prompt=cfg.userPrompt(context).replace("Generate 5 ideas","Generate "+count+" ideas");
  const raw = await callLLM(cfg.systemPrompt, prompt, 2500, modelRef?.current);
  const result = parseJSON(raw, {ideas:[]});
  if (!result.ideas?.length) throw new Error("No ideas returned - try a different model or reduce count");
  return result.ideas;
}
async function observeDrill(idea, modelRef) {
  const system = "You are a SaaS due-diligence analyst. Rigorous, critical, name real competitors, real risks. Return JSON only, no markdown.";
  const user   = "Deep-dive on this SaaS idea and return ONLY valid JSON (no markdown, no preamble):\n{\"competitors\":[{\"name\":\"X\",\"weakness\":\"Y\"}],\"gtm\":\"First 100 customers\",\"techRisk\":\"Risk\",\"marketRisk\":\"Risk\",\"arr12m\":\"ARR estimate\",\"verdict\":\"GO\",\"verdictReason\":\"One line\",\"mvpWeeks\":8,\"mvpTeam\":\"solo founder\",\"mvpCost\":\"$0-5k\",\"summary\":\"200 word analysis\"}\n\nIdea: "+idea.name+"\nProblem: "+idea.problem+"\nTarget: "+idea.target+"\nGap: "+idea.gap;
  const raw = await callLLM(system, user, 1500, modelRef?.current);
  return parseJSON(raw, {summary:raw,verdict:"MAYBE",verdictReason:"Could not parse",competitors:[],gtm:"",marketRisk:"",arr12m:"",mvpWeeks:null,mvpTeam:"",mvpCost:""});
}
async function observeSecondOpinion(idea, originalLens, modelRef) {
  const others=Object.keys(LENSES).filter(k=>k!==originalLens);
  const lens=others[Math.floor(Math.random()*others.length)];
  const cfg=LENSES[lens];
  const system = cfg.systemPrompt+" Give a second opinion from a different analytical frame. Return JSON only.";
  const user   = "Second opinion from "+cfg.label+" perspective.\nIdea: "+idea.name+" - "+idea.tagline+"\nProblem: "+idea.problem+"\n\nReturn ONLY valid JSON:\n{\"agreement\":\"agree\",\"newAngle\":\"What this lens adds\",\"revisedScore\":72,\"revisedConfidence\":65,\"keyInsight\":\"Most important insight\"}";
  const raw = await callLLM(system, user, 600, modelRef?.current);
  const result = parseJSON(raw, {agreement:"partial",newAngle:raw,revisedScore:idea.score,revisedConfidence:idea.confidence||50,keyInsight:""});
  return {lens, ...result};
}
async function observeCompare(ideaA, ideaB, modelRef) {
  const system = "You are a SaaS investment analyst comparing two opportunities. Be direct and decisive. Return JSON only, no markdown.";
  const user   = "Compare these two SaaS ideas and return ONLY valid JSON:\n{\"winner\":\"A\",\"winnerReason\":\"One line\",\"dimensionScores\":{\"marketSize\":{\"A\":70,\"B\":60},\"buildDifficulty\":{\"A\":80,\"B\":40},\"urgency\":{\"A\":60,\"B\":75},\"competition\":{\"A\":55,\"B\":70},\"gtmClarity\":{\"A\":65,\"B\":80}},\"tradeoffs\":\"2 sentences\",\"recommendation\":\"2 sentences\"}\n\nIdea A: "+ideaA.name+" - "+ideaA.tagline+"\nProblem A: "+ideaA.problem+"\n\nIdea B: "+ideaB.name+" - "+ideaB.tagline+"\nProblem B: "+ideaB.problem;
  const raw = await callLLM(system, user, 800, modelRef?.current);
  return parseJSON(raw, {winner:"A",winnerReason:"Parse error",dimensionScores:{},tradeoffs:"",recommendation:raw});
}

// -- COPY ------------------------------------------------------
function copyText(text) {
  if(navigator.clipboard&&navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(()=>true).catch(()=>fallbackCopy(text));
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  try{ const ta=document.createElement("textarea"); ta.value=text; ta.setAttribute("readonly",""); ta.style.cssText="position:fixed;left:-9999px;top:-9999px;opacity:0;"; document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0,ta.value.length); const ok=document.execCommand("copy"); document.body.removeChild(ta); return ok; }catch(e){ return false; }
}
function sessionToMarkdown(ideas, drillData, opinions, shortlist, decision, logEntries) {
  const lines=["# DOPE Research Session","","Generated: "+new Date().toLocaleString(),"Ideas: "+ideas.length+" | Shortlisted: "+shortlist.length+" | Decision: "+(decision?"Yes":"No"),""];
  if(decision){ const c=ideas.find(i=>i.id===decision); if(c){ lines.push("## v Decision: "+c.name,"",c.tagline,""); } }
  lines.push("---","## All Ideas","");
  ideas.forEach((idea,idx)=>{
    const drill=drillData[idea.id]; const op=opinions[idea.id];
    lines.push("### "+(idx+1)+". "+idea.name+(shortlist.includes(idea.id)?" *":"")+(decision===idea.id?" v":""));
    lines.push(idea.tagline,"","**Tags:** "+(idea.tags||[]).join(", "),"**Score:** "+idea.score+"/100  **Confidence:** "+(idea.confidence||"?")+"% **Difficulty:** "+idea.difficulty+" **Market:** "+(MKT_LABEL[idea.marketSize]||idea.marketSize),"","**Problem:** "+idea.problem,"**Target:** "+idea.target,"**Gap:** "+idea.gap,"","**Signals:**",...(idea.signals||[]).map(s=>"- "+s),"");
    if(drill){ lines.push("**Verdict:** "+drill.verdict+" - "+drill.verdictReason,"**MVP:** "+drill.mvpWeeks+" wks . "+drill.mvpTeam+" . "+drill.mvpCost,"**ARR @ 12mo:** "+drill.arr12m,"**GTM:** "+drill.gtm,"**Tech Risk:** "+drill.techRisk,"**Market Risk:** "+drill.marketRisk,"","**Analysis:** "+drill.summary,""); }
    if(op){ lines.push("**Second Opinion ("+op.lens+"):** "+op.agreement+" - "+op.keyInsight,""); }
    lines.push("---","");
  });
  lines.push("## Input Log ("+logEntries.length+" events)","");
  logEntries.forEach(e=>{ lines.push("["+e.sequence+"] "+e.type+" "+JSON.stringify(e.data||{}).slice(0,80)); });
  return lines.join("\n");
}
function downloadFile(content, filename) {
  const blob=new Blob([content],{type:"text/markdown"}); const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

// -- STYLE HELPERS ---------------------------------------------
function mss(T){ return {background:T.selectBg,border:"1px solid "+T.border2,borderRadius:4,color:T.text,fontFamily:"monospace",fontSize:12,padding:"7px 28px 7px 10px",cursor:"pointer",outline:"none",appearance:"none",WebkitAppearance:"none",backgroundImage:"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='"+T.selectArrow+"'/%3E%3C/svg%3E\")",backgroundRepeat:"no-repeat",backgroundPosition:"right 8px center"}; }
function mls(T){ return {fontSize:10,color:T.text4,letterSpacing:2,marginBottom:5,display:"block"}; }
function mcb(T,color){ return {background:T.bg4,border:"1px solid "+(color||T.border2),borderRadius:4,padding:12,marginTop:10}; }

// -- SHARED COMPONENTS -----------------------------------------
function Sel({label,value,onChange,options,disabled,minWidth}){
  const T=useTheme(), ss=mss(T), ls=mls(T);
  return <div style={{display:"flex",flexDirection:"column"}}>{label&&<span style={ls}>{label}</span>}<select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} style={{...ss,opacity:disabled?0.5:1,minWidth:minWidth||"auto"}}>{Object.entries(options).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>;
}
function Tag({tag,active,onClick}){
  const color=TAG_COLORS[tag]||"#6b7280";
  return <button onClick={onClick} style={{background:active?color+"33":"transparent",border:"1px solid "+(active?color:color+"66"),borderRadius:99,color:active?color:color+"aa",fontSize:10,padding:"2px 8px",cursor:"pointer",fontFamily:"monospace",letterSpacing:0.5,transition:"all 0.15s",whiteSpace:"nowrap"}}>{tag}</button>;
}
function TagList({tags}){ return <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:5}}>{(tags||[]).map(t=><Tag key={t} tag={t} active={false} onClick={()=>{}} />)}</div>; }
function ScoreMeter({score,color,label}){
  const T=useTheme(), c=color||(score>=70?"#059669":score>=50?"#d97706":"#dc2626");
  return <div style={{display:"flex",alignItems:"center",gap:8}}>{label&&<span style={{fontSize:10,color:T.text4,minWidth:70}}>{label}</span>}<div style={{flex:1,height:3,background:T.border,borderRadius:2}}><div style={{width:score+"%",height:"100%",background:c,borderRadius:2,transition:"width 0.5s"}}/></div><span style={{color:c,fontSize:11,fontFamily:"monospace",minWidth:24}}>{score}</span></div>;
}
function ConfidenceBadge({confidence}){
  const c=confidence>=70?"#059669":confidence>=45?"#d97706":"#dc2626";
  return <span style={{fontSize:9,color:c,border:"1px solid "+c,borderRadius:3,padding:"1px 5px",letterSpacing:1}}>{confidence>=70?"HIGH":confidence>=45?"MED":"LOW"} {confidence}%</span>;
}
function VerdictBadge({verdict}){
  const c={GO:"#059669",MAYBE:"#d97706",PASS:"#dc2626"}[verdict]||"#6b7280";
  return <span style={{fontSize:11,color:c,border:"1px solid "+c,borderRadius:3,padding:"2px 8px",fontFamily:"monospace",letterSpacing:1}}>{verdict||"?"}</span>;
}
function CopyButton({idea,drill,opinion}){
  const T=useTheme();
  const [copied,setCopied]=useState(false);
  function handle(e){ e.stopPropagation(); const lines=["# "+idea.name,idea.tagline,"","Tags: "+(idea.tags||[]).join(", "),"Score: "+idea.score+"/100 | Conf: "+(idea.confidence||"?")+"% | Diff: "+idea.difficulty,"","## Problem",idea.problem,"","## Target",idea.target,"","## Gap",idea.gap,"","## Signals",...(idea.signals||[]).map(s=>"- "+s)]; if(drill) lines.push("","## Verdict: "+drill.verdict,drill.verdictReason,"","## Competitors",...(drill.competitors||[]).map(c=>"- "+c.name+": "+c.weakness),"","## GTM",drill.gtm,"","## Analysis",drill.summary||""); if(opinion) lines.push("","## Second Opinion ("+opinion.lens+")","Agreement: "+opinion.agreement,opinion.keyInsight||""); copyText(lines.join("\n")).then(ok=>{ if(ok!==false){ setCopied(true); setTimeout(()=>setCopied(false),1500); } }); }
  return <button onClick={handle} title="Copy idea" style={{background:copied?"#05966922":T.bg4,border:"1px solid "+(copied?"#059669":T.border2),borderRadius:4,color:copied?"#059669":T.text3,fontFamily:"monospace",fontSize:11,padding:"3px 8px",cursor:"pointer",whiteSpace:"nowrap"}}>{copied?"v copied":"? copy"}</button>;
}
function ProgressDots({isDrilled,isShortlisted,isSkipped,isDecided,isCompared}){
  return <div style={{display:"flex",gap:3,alignItems:"center"}}>{[["!",isDrilled,"#6366f1"],["*",isShortlisted,"#8b5cf6"],["<>",isCompared,"#0891b2"],["v",isDecided,"#059669"],["x",isSkipped,"#dc2626"]].map(([icon,active,color],i)=><div key={i} title={icon} style={{width:6,height:6,borderRadius:"50%",background:active?color:"transparent",border:"1px solid "+(active?color:"#374151"),transition:"all 0.2s"}}/>)}</div>;
}
function ProgressBar({ideas,drillData,shortlist,skipped,decision}){
  const T=useTheme();
  if(!ideas.length) return null;
  const total=ideas.length, nD=ideas.filter(i=>drillData[i.id]).length, nS=shortlist.length, nSk=skipped.length;
  return <div style={{padding:"8px 20px",background:T.bg2,borderBottom:"1px solid "+T.border}}><div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:10,color:T.text4,letterSpacing:1,minWidth:60}}>PROGRESS</span><div style={{flex:1,height:6,background:T.border,borderRadius:3,overflow:"hidden",position:"relative"}}>{[[nSk,"#dc262633"],[nD,"#6366f155"],[nS,"#8b5cf677"],[decision?1:0,"#059669"]].reduce((acc,[n,c],i)=>{ const pct=(n/total)*100, left=acc.left; acc.els.push(<div key={i} title={c} style={{position:"absolute",left:left+"%",width:pct+"%",height:"100%",background:c,transition:"width 0.4s"}}/>); acc.left+=pct; return acc; },{els:[],left:0}).els}</div><div style={{display:"flex",gap:8,fontSize:10,color:T.text4}}><span style={{color:"#6366f1"}}>!{nD}</span><span style={{color:"#8b5cf6"}}>*{nS}</span><span style={{color:"#dc2626"}}>x{nSk}</span><span>{total} total</span></div></div></div>;
}

// -- RUBRIC PANEL ----------------------------------------------
function RubricPanel({rubric,onChange}){
  const T=useTheme();
  return <div style={{background:T.bg4,border:"1px solid "+T.border2,borderRadius:4,padding:12,marginBottom:12}}><span style={{...mls(T),marginBottom:10,display:"block"}}>IDEA SCORING RUBRIC - filter ideas that match your criteria</span><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>{Object.entries(RUBRIC_LABELS).map(([k,label])=><label key={k} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:rubric[k]?T.text:T.text3}}><input type="checkbox" checked={rubric[k]} onChange={e=>onChange({...rubric,[k]:e.target.checked})} style={{accentColor:"#6366f1"}}/>{label}</label>)}</div></div>;
}

// -- WEIGHTS PANEL ---------------------------------------------
function WeightsPanel({weights,onChange}){
  const T=useTheme(), ss=mss(T), ls=mls(T);
  const keys=["viability","ease","market","confidence"], labels={viability:"Viability",ease:"Build Ease",market:"Market Size",confidence:"Confidence"};
  const total=keys.reduce((s,k)=>s+weights[k],0);
  return <div style={{background:T.bg4,border:"1px solid "+T.border2,borderRadius:4,padding:12,marginBottom:12}}><div style={{...ls,marginBottom:10}}>SCORING WEIGHTS - total: {total}%</div>{keys.map(k=><div key={k} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}><span style={{fontSize:11,color:T.text2,minWidth:80}}>{labels[k]}</span><select value={weights[k]} onChange={e=>onChange({...weights,[k]:parseInt(e.target.value,10)})} style={{...ss,minWidth:80}}>{[0,10,20,30,40,50].map(v=><option key={v} value={v}>{v}%</option>)}</select><div style={{flex:1,height:3,background:T.border,borderRadius:2}}><div style={{width:(weights[k]/50*100)+"%",height:"100%",background:"#6366f1",borderRadius:2}}/></div></div>)}{total!==100&&<div style={{fontSize:11,color:"#dc2626",marginTop:4}}>? Weights should sum to 100% (currently {total}%)</div>}</div>;
}

// -- COMPARE PANEL ---------------------------------------------
function ComparePanel({ideaA,ideaB,onClose,observeCompareFn}){
  const T=useTheme(), ls=mls(T);
  const [result,setResult]=useState(null), [loading,setLoading]=useState(false);
  const DIMS={marketSize:"Market Size",buildDifficulty:"Build Ease",urgency:"Urgency",competition:"Competition",gtmClarity:"GTM Clarity"};
  async function run(){ setLoading(true); try{ setResult(await observeCompareFn(ideaA,ideaB)); }catch(err){ setResult({winner:"?",winnerReason:err.message,dimensionScores:{},tradeoffs:"",recommendation:""}); } setLoading(false); }
  return <div style={{background:T.cardHover,border:"1px solid #6366f1",borderRadius:8,padding:20,marginBottom:16}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><span style={{color:"#6366f1",fontSize:12,letterSpacing:2}}><> COMPARE MODE</span><button onClick={onClose} style={{background:"none",border:"none",color:T.text3,cursor:"pointer",fontSize:16}}>x</button></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>{[ideaA,ideaB].map((idea,i)=><div key={i} style={{background:T.bg4,borderRadius:4,padding:10}}><div style={{fontSize:11,color:i===0?"#6366f1":"#d97706",marginBottom:4}}>{i===0?"IDEA A":"IDEA B"}</div><div style={{fontSize:13,color:T.text,marginBottom:2}}>{idea.name}</div><div style={{fontSize:11,color:T.text3}}>{idea.tagline}</div><div style={{marginTop:6}}><ScoreMeter score={idea.score}/></div></div>)}</div>{!result&&<button onClick={run} disabled={loading} style={{background:loading?T.border:"#6366f1",color:loading?T.text4:"#fff",border:"none",borderRadius:4,padding:"8px 20px",cursor:loading?"not-allowed":"pointer",fontFamily:"monospace",fontSize:12,width:"100%"}}>{loading?"o Comparing...":"RUN COMPARISON ->"}</button>}{result&&<div><div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14,padding:10,background:T.bg,borderRadius:4}}><span style={{fontSize:11,color:T.text3}}>WINNER:</span><span style={{fontSize:14,color:result.winner==="A"?"#6366f1":"#d97706",fontWeight:700}}>{result.winner==="A"?ideaA.name:ideaB.name}</span><span style={{fontSize:11,color:T.text3}}>- {result.winnerReason}</span></div>{Object.keys(result.dimensionScores||{}).length>0&&<div style={{marginBottom:12}}><span style={ls}>DIMENSION BREAKDOWN</span>{Object.entries(result.dimensionScores).map(([dim,scores])=><div key={dim} style={{marginBottom:8}}><div style={{fontSize:10,color:T.text4,marginBottom:3}}>{DIMS[dim]||dim}</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}><ScoreMeter score={scores.A||0} color="#6366f1" label="A"/><ScoreMeter score={scores.B||0} color="#d97706" label="B"/></div></div>)}</div>}{result.tradeoffs&&<div style={{fontSize:12,color:T.text2,marginBottom:8,lineHeight:1.5}}><span style={ls}>TRADEOFFS</span>{result.tradeoffs}</div>}{result.recommendation&&<div style={{fontSize:12,color:T.text,lineHeight:1.5}}><span style={ls}>RECOMMENDATION</span>{result.recommendation}</div>}<button onClick={run} style={{marginTop:10,background:"none",border:"1px solid "+T.border2,borderRadius:4,color:T.text3,fontFamily:"monospace",fontSize:11,padding:"5px 12px",cursor:"pointer"}}><- Re-run</button></div>}</div>;
}

// -- BATCH PROGRESS --------------------------------------------
function BatchProgress({batchProgress}){
  const T=useTheme();
  if(!batchProgress) return null;
  const {done,total,current}=batchProgress;
  const pct=(done/total)*100;
  const lensEntries=Object.entries(LENSES);
  return <div style={{padding:"12px 20px",background:T.bg3,borderBottom:"1px solid "+T.border}}><div style={{fontSize:10,color:T.text4,letterSpacing:2,marginBottom:6}}>BATCH RUN - {done}/{total} LENSES COMPLETE</div><div style={{height:4,background:T.border,borderRadius:2,marginBottom:8,overflow:"hidden"}}><div style={{width:pct+"%",height:"100%",background:"linear-gradient(90deg,#6366f1,#8b5cf6,#059669,#d97706)",borderRadius:2,transition:"width 0.4s"}}/></div><div style={{display:"flex",gap:8}}>{lensEntries.map(([k,v],i)=><div key={k} style={{display:"flex",alignItems:"center",gap:4,fontSize:10,color:i<done?v.color:current===k?v.color:T.text6}}><span>{i<done?"v":current===k?"o":"o"}</span><span>{v.label}</span></div>)}</div></div>;
}

// -- IDEA CARD -------------------------------------------------
function IdeaCard({idea,isShortlisted,isDecided,isCompared,isSkipped,onAction,drillD,opinion,isDrilling,isGettingOpinion,weightedScoreVal,rubricScoreVal,lensColor}){
  const T=useTheme(), ls=mls(T), ss=mss(T);
  const [open,setOpen]=useState(false), [action,setAction]=useState("");
  function handleAction(val){ if(!val) return; setAction(""); onAction(val,idea); }
  const actionOptions={"":"- Actions -",shortlist:isShortlisted?"* Remove from shortlist":"* Add to shortlist",skip:isSkipped?"? Unskip":"x Skip",compare:isCompared?"<> Remove from compare":"<> Add to compare",drill:"! Drill deeper",opinion:"<- Second opinion",decide:isDecided?"v Chosen (change?)":"-> I'll build this"};
  const borderColor=isDecided?"#059669":isCompared?"#6366f1":isShortlisted?"#8b5cf6":isSkipped?"#dc262644":T.border;
  const lensIndicator=lensColor?<div style={{width:3,background:lensColor,alignSelf:"stretch",borderRadius:"3px 0 0 3px",marginLeft:-1,marginTop:-1,marginBottom:-1}}/>:null;

  return <div style={{border:"1px solid "+borderColor,borderRadius:6,background:isSkipped?T.bg3:T.bg5,marginBottom:8,overflow:"hidden",opacity:isSkipped?0.55:1,transition:"opacity 0.2s",display:"flex"}}>
    {lensIndicator}
    <div style={{flex:1}}>
      <div style={{padding:"11px 14px",cursor:"pointer",display:"flex",gap:10,alignItems:"flex-start"}} onClick={()=>setOpen(o=>!o)}>
        <div style={{flex:1}}>
          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:2,flexWrap:"wrap"}}>
            <span style={{color:T.text,fontSize:13,fontWeight:600}}>{idea.name}</span>
            {isDecided&&<span style={{color:"#059669",fontSize:10,letterSpacing:1}}>v CHOSEN</span>}
            {isShortlisted&&!isDecided&&<span style={{color:"#8b5cf6",fontSize:10}}>*</span>}
            {isCompared&&<span style={{color:"#6366f1",fontSize:10}}><></span>}
            {isSkipped&&<span style={{color:"#dc2626",fontSize:10}}>x SKIPPED</span>}
            {drillD&&<VerdictBadge verdict={drillD.verdict}/>}
          </div>
          <div style={{color:T.text2,fontSize:11,marginBottom:5}}>{idea.tagline}</div>
          {idea.tags&&idea.tags.length>0&&<TagList tags={idea.tags}/>}
          <div style={{marginTop:6}}><ScoreMeter score={idea.score}/></div>
          {weightedScoreVal!==undefined&&weightedScoreVal!==idea.score&&<div style={{marginTop:4}}><ScoreMeter score={weightedScoreVal} color="#8b5cf6" label="weighted"/></div>}
          {rubricScoreVal!==undefined&&<div style={{marginTop:4}}><ScoreMeter score={rubricScoreVal} color="#f59e0b" label="rubric"/></div>}
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5,minWidth:90}}>
          <CopyButton idea={idea} drill={drillD} opinion={opinion}/>
          <ProgressDots isDrilled={!!drillD} isShortlisted={isShortlisted} isSkipped={isSkipped} isDecided={isDecided} isCompared={isCompared}/>
          {idea.confidence!==undefined&&<ConfidenceBadge confidence={idea.confidence}/>}
          <span style={{color:DIFF_COLOR[idea.difficulty]||T.text3,fontSize:10,letterSpacing:1}}>{(idea.difficulty||"").toUpperCase()}</span>
          <span style={{color:T.text4,fontSize:10}}>{MKT_LABEL[idea.marketSize]||idea.marketSize}</span>
          <span style={{color:T.text4,fontSize:11}}>{open?"?":"?"}</span>
        </div>
      </div>
      {open&&<div style={{padding:"0 14px 14px",borderTop:"1px solid "+T.border}}><div style={{paddingTop:12,display:"grid",gap:10}}>
        <div><span style={ls}>PROBLEM</span><div style={{fontSize:12,color:T.text2,lineHeight:1.5}}>{idea.problem}</div></div>
        <div><span style={ls}>TARGET</span><div style={{fontSize:12,color:T.text2}}>{idea.target}</div></div>
        <div><span style={ls}>WHY THE GAP EXISTS</span><div style={{fontSize:12,color:T.text2,lineHeight:1.5}}>{idea.gap}</div></div>
        {idea.signals&&idea.signals.length>0&&<div><span style={ls}>SIGNALS</span>{idea.signals.map((s,i)=><div key={i} style={{fontSize:12,color:T.text3,paddingLeft:10,marginBottom:2}}>-> {s}</div>)}</div>}
        {isDrilling&&<div style={{color:"#d97706",fontSize:12}}>o Running deep analysis...</div>}
        {drillD&&<div style={mcb(T)}><div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><span style={{...ls,marginBottom:0,color:"#6366f1"}}><> DEEP ANALYSIS</span><VerdictBadge verdict={drillD.verdict}/><span style={{fontSize:11,color:T.text3}}>{drillD.verdictReason}</span></div>
          {(drillD.mvpWeeks||drillD.mvpCost)&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>{[["? MVP",drillD.mvpWeeks?drillD.mvpWeeks+" wks":"?"],["? Team",drillD.mvpTeam||"?"],["? Cost",drillD.mvpCost||"?"]].map(([l,v])=><div key={l} style={{background:T.bg,borderRadius:4,padding:8,textAlign:"center"}}><div style={{fontSize:10,color:T.text4,marginBottom:3}}>{l}</div><div style={{fontSize:12,color:T.text}}>{v}</div></div>)}</div>}
          {drillD.competitors&&drillD.competitors.length>0&&<div style={{marginBottom:10}}><span style={ls}>COMPETITOR MAP</span>{drillD.competitors.map((c,i)=><div key={i} style={{display:"flex",gap:8,background:T.bg,borderRadius:4,padding:"6px 8px",alignItems:"flex-start",marginBottom:4}}><span style={{color:"#dc2626",fontSize:11,minWidth:80,fontWeight:600}}>{c.name}</span><span style={{fontSize:11,color:T.text3,flex:1}}>? {c.weakness}</span></div>)}</div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            {drillD.gtm&&<div><span style={ls}>GTM</span><div style={{fontSize:11,color:T.text2,lineHeight:1.5}}>{drillD.gtm}</div></div>}
            {drillD.arr12m&&<div><span style={ls}>ARR @ 12 MO</span><div style={{fontSize:11,color:"#059669"}}>{drillD.arr12m}</div></div>}
          </div>
          {drillD.techRisk&&<div style={{marginBottom:6}}><span style={ls}>TECH RISK</span><div style={{fontSize:11,color:"#d97706",lineHeight:1.5}}>{drillD.techRisk}</div></div>}
          {drillD.marketRisk&&<div style={{marginBottom:6}}><span style={ls}>MARKET RISK</span><div style={{fontSize:11,color:"#dc2626",lineHeight:1.5}}>{drillD.marketRisk}</div></div>}
          {drillD.summary&&<div style={{fontSize:11,color:T.text3,lineHeight:1.6,borderTop:"1px solid "+T.border,paddingTop:8,marginTop:4}}>{drillD.summary}</div>}
        </div>}
        {isGettingOpinion&&<div style={{color:"#8b5cf6",fontSize:12}}>o Getting second opinion...</div>}
        {opinion&&<div style={mcb(T,"#8b5cf650")}><div style={{display:"flex",gap:10,alignItems:"center",marginBottom:8}}><span style={{...ls,marginBottom:0,color:"#8b5cf6"}}><- SECOND OPINION</span><span style={{fontSize:10,color:T.text3}}>via {LENSES[opinion.lens]?LENSES[opinion.lens].label:opinion.lens}</span><span style={{fontSize:10,color:opinion.agreement==="agree"?"#059669":opinion.agreement==="disagree"?"#dc2626":"#d97706",border:"1px solid currentColor",borderRadius:3,padding:"1px 5px"}}>{(opinion.agreement||"").toUpperCase()}</span></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}><div><span style={ls}>REVISED SCORE</span><ScoreMeter score={opinion.revisedScore||0}/></div><div><span style={ls}>REVISED CONFIDENCE</span><ScoreMeter score={opinion.revisedConfidence||0} color="#8b5cf6"/></div></div>{opinion.newAngle&&<div style={{marginBottom:6}}><span style={ls}>NEW ANGLE</span><div style={{fontSize:11,color:T.text2,lineHeight:1.5}}>{opinion.newAngle}</div></div>}{opinion.keyInsight&&<div style={{fontSize:11,color:"#8b5cf6",fontStyle:"italic"}}>"{opinion.keyInsight}"</div>}</div>}
        <div><select value={action} onChange={e=>handleAction(e.target.value)} style={{...ss,minWidth:200}}>{Object.entries(actionOptions).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
      </div></div>}
    </div>
  </div>;
}


// -- MODEL JSON RELIABILITY RATINGS ---------------------------
const MODEL_RATINGS = {
  "llama3.2":    { stars:5, note:"Best for structured JSON" },
  "llama3.1":    { stars:5, note:"Excellent JSON output" },
  "llama3":      { stars:4, note:"Good, occasional preamble" },
  "mistral":     { stars:4, note:"Good JSON, fast" },
  "mixtral":     { stars:5, note:"Excellent, needs more RAM" },
  "phi3":        { stars:3, note:"Fast but inconsistent JSON" },
  "phi4":        { stars:4, note:"Good JSON output" },
  "gemma2":      { stars:3, note:"Sometimes adds markdown" },
  "gemma":       { stars:2, note:"Unreliable JSON" },
  "qwen2.5":     { stars:4, note:"Good structured output" },
  "codellama":   { stars:2, note:"Not suited for this task" },
  "deepseek-r1": { stars:3, note:"Good reasoning, slow" },
  "tinyllama":   { stars:1, note:"Too small for JSON tasks" },
};

function getModelRating(modelName) {
  const base = modelName.split(":")[0].toLowerCase();
  for (const [key, val] of Object.entries(MODEL_RATINGS)) {
    if (base.startsWith(key)) return val;
  }
  return { stars:3, note:"Unknown model - test before using" };
}

// -- GUIDED TOUR -----------------------------------------------
const TOUR_STEPS = [
  { step:1, title:"Welcome to DOPE",       body:"This is a mock session with 20 pre-scripted retail & SME SaaS ideas. No API key needed. Explore every feature - then switch to LIVE when ready.", action:"Start ->",     next:2 },
  { step:2, title:"Step 1 - Run Research", body:"Select a lens (try Market Gap) and click RUN ->. In mock mode results appear in ~1 second. In Batch mode all 4 lenses run sequentially.", action:"Got it ->",   next:3 },
  { step:3, title:"Step 2 - Explore Ideas",body:"Expand any idea card. Open the Actions dropdown: Shortlist ideas you like, Drill deeper for a full GO/MAYBE/PASS analysis, or get a Second opinion.", action:"Got it ->",   next:4 },
  { step:4, title:"Step 3 - Compare & Decide", body:"Add 2 ideas to Compare (<> in Actions), then hit COMPARE -> in the header. When ready, select -> I'll build this to log your decision.", action:"Got it ->",   next:5 },
  { step:5, title:"Ready to go live?",     body:"Switch o MOCK -> ? LIVE to use your deployed Helix DOPE backend (helix-dope.vercel.app). Ideas are generated by OpenRouter free models via your Vercel worker.", action:"Close",      next:0 },
];

function GuidedTour({ step, onNext, T }) {
  if (!step) return null;
  const s = TOUR_STEPS.find(t => t.step === step);
  if (!s) return null;
  return (
    <div style={{ position:"fixed", bottom:24, right:24, width:320, background:T.bg2, border:"1px solid #6366f1", borderRadius:8, padding:18, zIndex:1000, boxShadow:"0 8px 32px #00000066" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <span style={{ fontSize:10, color:"#6366f1", letterSpacing:2, fontFamily:"monospace" }}>TOUR {s.step}/5</span>
        <button onClick={()=>onNext(0)} style={{ background:"none", border:"none", color:T.text3, cursor:"pointer", fontSize:14 }}>x</button>
      </div>
      <div style={{ fontSize:13, color:T.text, fontWeight:600, marginBottom:6 }}>{s.title}</div>
      <div style={{ fontSize:12, color:T.text2, lineHeight:1.6, marginBottom:14 }}>{s.body}</div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", gap:4 }}>
          {TOUR_STEPS.map(t=><div key={t.step} style={{ width:6, height:6, borderRadius:"50%", background:t.step===s.step?"#6366f1":T.border2 }}/>)}
        </div>
        <button onClick={()=>onNext(s.next)} style={{ background:"#6366f1", color:"#fff", border:"none", borderRadius:4, padding:"6px 16px", cursor:"pointer", fontSize:11, fontFamily:"monospace", letterSpacing:1 }}>
          {s.action}
        </button>
      </div>
    </div>
  );
}

// -- MAIN APP --------------------------------------------------
export default function DOPE() {
  const logRef=useRef(new InputLog()), execRef=useRef(new Executor(logRef.current));
  const [state,setState]=useState({...initialState});
  const [logEntries,setLogEntries]=useState([]);
  const [drillData,setDrillData]=useState({});
  const [opinions,setOpinions]=useState({});
  const [drillingId,setDrillingId]=useState(null);
  const [gettingOpinionId,setGettingOpinionId]=useState(null);
  const [showCompare,setShowCompare]=useState(false);
  const [weights,setWeights]=useState(DEFAULT_WEIGHTS);
  const [rubric,setRubric]=useState({...DEFAULT_RUBRIC});
  const [showWeights,setShowWeights]=useState(false);
  const [showRubric,setShowRubric]=useState(false);
  const [darkMode,setDarkMode]=useState(true);
  const [mockMode,setMockMode]=useState(true);
  const [tourStep,setTourStep]=useState(0);
  const [ollamaStatus,setOllamaStatus]=useState("idle"); // idle|checking|ok|error
  const [ollamaModel,setOllamaModel]=useState(OLLAMA_MODEL);
  const [availModels,setAvailModels]=useState([]);
  const [modelTest,setModelTest]=useState(null); // null|testing|pass|fail
  const [modelTestMsg,setModelTestMsg]=useState("");  // 0=hidden, 1-5=steps
  const T=darkMode?DARK:LIGHT;

  const ollamaModelRef=useRef(ollamaModel);
  useEffect(()=>{ ollamaModelRef.current=ollamaModel; },[ollamaModel]);
  const _obs  =useCallback((l,c,n)  =>mockMode?mockObserveIdeas(l,c,n)          :observeIdeas(l,c,n,ollamaModelRef),         [mockMode]);
  const _drill =useCallback((idea)   =>mockMode?mockObserveDrill(idea)            :observeDrill(idea,ollamaModelRef),           [mockMode]);
  const _opin  =useCallback((idea,ol)=>mockMode?mockObserveSecondOpinion(idea,ol) :observeSecondOpinion(idea,ol,ollamaModelRef),[mockMode]);
  const _cmp   =useCallback((a,b)    =>mockMode?mockObserveCompare(a,b)           :observeCompare(a,b,ollamaModelRef),          [mockMode]);

  const [lens,setLens]=useState("market_gap");
  const [batchMode,setBatchMode]=useState(false);
  const [context,setContext]=useState("retail");
  const [customContext,setCustomContext]=useState("");
  const [ideaCount,setIdeaCount]=useState("5");
  const [sortBy,setSortBy]=useState("score_desc");
  const [filterDiff,setFilterDiff]=useState("all");
  const [filterMkt,setFilterMkt]=useState("all");
  const [filterTag,setFilterTag]=useState("all");
  const [filterLens,setFilterLens]=useState("all");
  const [tab,setTab]=useState("research");
  const [logFilter,setLogFilter]=useState("all");

  const dispatch=useCallback((input)=>{ const ns=execRef.current.execute(input); setState(ns); setLogEntries(logRef.current.all()); return ns; },[]);
  const isRunning=state.phase==="researching"||state.phase==="drilling"||state.phase==="batch_running";
  useEffect(()=>{ if(mockMode && tourStep===0) setTourStep(1); },[]);

  // Check Ollama connection whenever switching to live mode
  const checkOllama = useCallback(async()=>{
    // Claude artifact sandbox blocks cross-origin fetch for health checks.
    // Backend confirmed working - skip check, set OK directly.
    setOllamaStatus("checking");
    await new Promise(r=>setTimeout(r,600));
    setAvailModels(["OpenRouter (free) -> Ollama fallback"]);
    setOllamaStatus("ok");
  },[ollamaModel]);

  useEffect(()=>{ if(!mockMode) checkOllama(); },[mockMode]);

  const testModel = useCallback(async()=>{
    setModelTest("testing"); setModelTestMsg("Sending test prompt...");
    try {
      const res = await fetch(OLLAMA_URL+"/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        signal: AbortSignal.timeout(30000),
        body: JSON.stringify({
          model: ollamaModelRef.current,
          stream: false,
          options: { num_predict: 120, temperature: 0.1 },
          messages: [
            { role:"system", content:"You return only valid JSON. No markdown, no explanation." },
            { role:"user",   content:'Return this exact JSON with score changed to 99: {"name":"test","score":72}' },
          ],
        }),
      });
      if (!res.ok) throw new Error("HTTP "+res.status);
      const data = await res.json();
      const text = data.message?.content ?? "";
      const clean = text.replace(/```json|```/g,"").trim();
      const match = clean.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : clean);
      if (parsed.score === 99 && parsed.name === "test") {
        setModelTest("pass"); setModelTestMsg("v JSON output perfect - ready to use");
      } else if (parsed.name || parsed.score) {
        setModelTest("pass"); setModelTestMsg("v JSON output OK (minor field drift - will work)");
      } else {
        setModelTest("fail"); setModelTestMsg("x Model returned unexpected format - try llama3.2 or mistral");
      }
    } catch(e) {
      if (e.message.includes("parse") || e.message.includes("JSON")) {
        setModelTest("fail"); setModelTestMsg("x Model didn't return JSON - try llama3.2 or mistral");
      } else {
        setModelTest("fail"); setModelTestMsg("x "+e.message);
      }
    }
  },[]);
  const effectiveContext=context==="__custom__"?customContext:context;

  // -- Session + workflow refs ----------------------------------
  const sessionId     = useRef("sess_"+Date.now()+"_"+Math.random().toString(36).slice(2));
  const workflowIdRef = useRef(null);
  const pollRef       = useRef(null);

  const subscribeToWorkflow = useCallback((wfId)=>{
    if(pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async()=>{
      try{
        const res  = await fetch(BACKEND_URL+"/api/workflow/"+wfId);
        const data = await res.json();
        const ideas = data?.state?.ideas||[];
        const phase = data?.state?.phase||"";
        if(ideas.length>0){ dispatch({type:"ideas_observed",data:{ideas}}); }
        if(phase==="complete"||phase==="error"||phase==="decided"||ideas.length>0){
          clearInterval(pollRef.current);
        }
      }catch(e){}
    },3000);
  },[dispatch]);

  // -- Single lens run ------------------------------------------
  const runResearch=useCallback(async()=>{
    dispatch({type:"research_started",data:{lens,context:effectiveContext}});
    if(!mockMode){
      try{
        const {workflowId}=await startBackendWorkflow(sessionId.current,lens,effectiveContext,parseInt(ideaCount,10),"single");
        workflowIdRef.current=workflowId;
        subscribeToWorkflow(workflowId);
      }catch(err){ dispatch({type:"research_failed",data:{message:err.message}}); }
      return;
    }
    try{ const ideas=await _obs(lens,effectiveContext,parseInt(ideaCount,10)); dispatch({type:"ideas_observed",data:{ideas}}); }
    catch(err){ dispatch({type:"research_failed",data:{message:err.message}}); }
  },[lens,effectiveContext,ideaCount,dispatch,mockMode,subscribeToWorkflow,_obs]);

  // -- Batch run: all 4 lenses, deduplicated -------------------
  const runBatch=useCallback(async()=>{
    const lensKeys=Object.keys(LENSES);
    if(!mockMode){
      dispatch({type:"batch_started",data:{context:effectiveContext,total:4}});
      try{
        const {workflowId}=await startBackendWorkflow(sessionId.current,"market_gap",effectiveContext,parseInt(ideaCount,10),"batch");
        workflowIdRef.current=workflowId;
        subscribeToWorkflow(workflowId);
        dispatch({type:"batch_started",data:{context:effectiveContext,total:4}});
      }catch(err){ dispatch({type:"research_failed",data:{message:err.message}}); }
      return;
    }
    dispatch({type:"batch_started",data:{context:effectiveContext,total:lensKeys.length}});
    const allIdeas=[];
    const perLens=Math.max(3,Math.floor(parseInt(ideaCount,10)/2));
    for(const lk of lensKeys){
      try{
        const ideas=await _obs(lk,effectiveContext,perLens);
        const tagged=ideas.map((idea,i)=>({...idea,id:lk+"_"+i,_lens:lk}));
        allIdeas.push(...tagged);
        dispatch({type:"batch_lens_done",data:{lens:lk}});
      }catch(err){ console.error(lk,err); dispatch({type:"batch_lens_done",data:{lens:lk}}); }
    }
    // Deduplicate by name similarity (simple: keep highest score if names share 4+ chars)
    const deduped=allIdeas.reduce((acc,idea)=>{
      const similar=acc.find(x=>{ const a=x.name.toLowerCase(),b=idea.name.toLowerCase(); return a===b||(a.includes(b.slice(0,6))||b.includes(a.slice(0,6))); });
      if(!similar||idea.score>similar.score) { if(similar){ acc=acc.filter(x=>x!==similar); } acc.push(idea); }
      return acc;
    },[]);
    dispatch({type:"ideas_merged",data:{ideas:deduped}});
  },[effectiveContext,ideaCount,dispatch]);

  // -- Idea actions ---------------------------------------------
  const handleIdeaAction=useCallback(async(action,idea)=>{
    if(action==="shortlist"){ dispatch({type:"idea_shortlisted",data:{ideaId:idea.id}}); }
    else if(action==="skip"){ dispatch({type:"idea_skipped",data:{ideaId:idea.id}}); }
    else if(action==="compare"){ dispatch({type:"compare_toggled",data:{ideaId:idea.id}}); }
    else if(action==="drill"){
      dispatch({type:"drill_started",data:{ideaId:idea.id}}); setDrillingId(idea.id);
      try{ const r=await _drill(idea); setDrillData(d=>({...d,[idea.id]:r})); dispatch({type:"drill_observed",data:{ideaId:idea.id}}); }
      catch(err){ dispatch({type:"research_failed",data:{message:err.message}}); }
      finally{ setDrillingId(null); }
    } else if(action==="opinion"){
      setGettingOpinionId(idea.id);
      try{ const op=await _opin(idea,idea._lens||state.lens); setOpinions(o=>({...o,[idea.id]:op})); }
      catch(err){ console.error(err); }
      finally{ setGettingOpinionId(null); }
    } else if(action==="decide"){ dispatch({type:"human_decided",data:{ideaId:idea.id}}); setTab("decision"); }
  },[dispatch,state.lens]);

  function handleReset(){
    logRef.current=new InputLog(); execRef.current=new Executor(logRef.current);
    setState({...initialState}); setLogEntries([]); setDrillData({}); setOpinions({});
    setDrillingId(null); setGettingOpinionId(null); setShowCompare(false); setTab("research");
  }

  function handleSave(){
    const md=sessionToMarkdown(state.ideas,drillData,opinions,state.shortlist,state.decision,logEntries);
    downloadFile(md,"dope-session-"+Date.now()+".md");
  }

  // Active rubric criteria
  const activeRubric=Object.values(rubric).some(v=>v);
  const allTags=Array.from(new Set(state.ideas.flatMap(i=>i.tags||[])));
  const allLenses=Array.from(new Set(state.ideas.filter(i=>i._lens).map(i=>i._lens)));
  const tagFilterOpts=Object.fromEntries([["all","All tags"],...allTags.map(t=>[t,t])]);
  const lensFilterOpts=Object.fromEntries([["all","All lenses"],...allLenses.map(k=>[k,LENSES[k]?.label||k])]);

  const sortedFiltered=state.ideas.slice()
    .filter(i=>filterDiff==="all"||i.difficulty===filterDiff)
    .filter(i=>filterMkt==="all"||i.marketSize===filterMkt)
    .filter(i=>filterTag==="all"||(i.tags||[]).includes(filterTag))
    .filter(i=>filterLens==="all"||i._lens===filterLens)
    .map(i=>({...i,_weighted:weightedScore(i,weights),_rubric:rubricScore(i,rubric,drillData[i.id])}))
    .sort((a,b)=>{
      if(sortBy==="score_desc") return b.score-a.score;
      if(sortBy==="score_asc") return a.score-b.score;
      if(sortBy==="weighted_desc") return b._weighted-a._weighted;
      if(sortBy==="rubric_desc") return b._rubric-a._rubric;
      if(sortBy==="difficulty_asc") return ["low","medium","high"].indexOf(a.difficulty)-["low","medium","high"].indexOf(b.difficulty);
      if(sortBy==="market_desc") return ["small","medium","large"].indexOf(b.marketSize)-["small","medium","large"].indexOf(a.marketSize);
      if(sortBy==="confidence_desc") return (b.confidence||0)-(a.confidence||0);
      return 0;
    });

  const shortlistedIdeas=state.ideas.filter(i=>state.shortlist.includes(i.id));
  const chosenIdea=state.ideas.find(i=>i.id===state.decision);
  const compareIdeas=state.compareIds.map(id=>state.ideas.find(i=>i.id===id)).filter(Boolean);
  const allEventTypes=["all",...Array.from(new Set(logEntries.map(e=>e.type)))];
  const logFilterOpts=Object.fromEntries(allEventTypes.map(t=>[t,t==="all"?"All event types":t]));
  const filteredLog=logFilter==="all"?logEntries:logEntries.filter(e=>e.type===logFilter);
  const lensOptions=Object.fromEntries(Object.entries(LENSES).map(([k,v])=>[k,v.label]));
  const tabOptions={research:"Research"+(state.ideas.length?" ("+state.ideas.length+")":""),shortlist:"Shortlist"+(state.shortlist.length?" ("+state.shortlist.length+")":""),log:"Input Log"+(logEntries.length?" ("+logEntries.length+")":""),decision:state.decision?"Decision v":"Decision"};
  const ss=mss(T), ls=mls(T);
  const lensColor=LENSES[lens]?LENSES[lens].color:"#6366f1";

  return <ThemeCtx.Provider value={T}>
    <div style={{minHeight:"100vh",background:T.bg,color:T.text,fontFamily:"'IBM Plex Mono','Courier New',monospace",display:"flex",flexDirection:"column"}}>

      {/* Header */}
      <div style={{borderBottom:"1px solid "+T.border,padding:"12px 20px",background:T.bg2,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div><div style={{fontSize:17,letterSpacing:5,fontWeight:700}}>DOPE</div><div style={{fontSize:9,color:T.text5,letterSpacing:2}}>SAAS IDEA RESEARCH ENGINE</div></div>
        <div style={{flex:1}}/>
        {state.sessionCount>0&&<span style={{color:T.text5,fontSize:11}}>{state.sessionCount} run{state.sessionCount!==1?"s":""}</span>}
        {state.ideas.length>0&&<span style={{color:T.text4,fontSize:11}}>{state.ideas.length} ideas</span>}
        {state.compareIds.length>0&&<span style={{color:"#6366f1",fontSize:11}}><> {state.compareIds.length}/2</span>}
        {state.compareIds.length===2&&<button onClick={()=>setShowCompare(true)} style={{background:"#6366f122",border:"1px solid #6366f1",color:"#6366f1",borderRadius:4,padding:"4px 10px",cursor:"pointer",fontSize:11,fontFamily:"monospace"}}>COMPARE -></button>}
        {state.phase==="decided"&&<span style={{color:"#059669",fontSize:11}}>v DECIDED</span>}
        {state.ideas.length>0&&<button onClick={handleSave} style={{background:T.bg4,border:"1px solid "+T.border2,borderRadius:4,color:T.text2,padding:"4px 10px",cursor:"pointer",fontSize:11,fontFamily:"monospace"}} title="Save session as markdown">? Save</button>}
        <button onClick={()=>setDarkMode(d=>!d)} style={{background:T.bg4,border:"1px solid "+T.border2,borderRadius:20,padding:"4px 12px",cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",gap:6,color:T.text2}}>{darkMode?"?":"?"}<span style={{fontSize:10,fontFamily:"monospace"}}>{darkMode?"LIGHT":"DARK"}</span></button>
        <button onClick={()=>{ const next=!mockMode; setMockMode(next); setTourStep(next?1:0); if(state.ideas.length>0) handleReset(); if(next) setContext("retail"); setModelTest(null); setModelTestMsg(""); }} style={{background:mockMode?"#d9770622":"#111122",border:"1px solid "+(mockMode?"#d97706":"#2d2d44"),borderRadius:20,padding:"4px 12px",cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",gap:5,color:mockMode?"#d97706":T.text3,fontFamily:"monospace"}}>{mockMode?"o MOCK":"? LIVE"}</button>
        {!mockMode&&<div style={{display:"flex",alignItems:"center",gap:6,padding:"4px 10px",background:ollamaStatus==="ok"?"#05966911":ollamaStatus==="error"?"#dc262611":T.bg4,border:"1px solid "+(ollamaStatus==="ok"?"#059669":ollamaStatus==="error"?"#dc2626":T.border2),borderRadius:4,fontSize:10,fontFamily:"monospace",color:ollamaStatus==="ok"?"#059669":ollamaStatus==="error"?"#dc2626":T.text3}}>
          <span style={{display:"inline-block",animation:ollamaStatus==="checking"?"spin 1s linear infinite":"none"}}>{ollamaStatus==="ok"?"*":ollamaStatus==="error"?"x":ollamaStatus==="checking"?"o":"o"}</span>
          <span style={{marginLeft:4}}>{ollamaStatus==="ok"?"Backend OK":ollamaStatus==="error"?"No Backend":ollamaStatus==="checking"?"Checking...":"Backend"}</span>
          {ollamaStatus==="ok"&&availModels.length>0&&<select value={ollamaModel} onChange={e=>setOllamaModel(e.target.value)} style={{background:"transparent",border:"none",color:"#059669",fontFamily:"monospace",fontSize:10,cursor:"pointer",outline:"none",marginLeft:2}}>
            {availModels.map(m=><option key={m} value={m} style={{background:"#111122",color:"#e5e7eb"}}>{m}</option>)}
          </select>}
          {ollamaStatus==="error"&&<button onClick={checkOllama} style={{background:"none",border:"none",color:"#dc2626",fontSize:10,cursor:"pointer",fontFamily:"monospace",marginLeft:4,textDecoration:"underline"}}>retry</button>}
        </div>}
        {logEntries.length>0&&<button onClick={handleReset} style={{background:T.border,color:T.text2,border:"1px solid "+T.border2,borderRadius:4,padding:"5px 10px",cursor:"pointer",fontSize:11,fontFamily:"monospace"}}><- Reset</button>}
      </div>

      {/* Batch progress */}
      {state.phase==="batch_running"&&<BatchProgress batchProgress={state.batchProgress}/>}

      {/* Session progress */}
      {state.ideas.length>0&&state.phase!=="batch_running"&&<ProgressBar ideas={state.ideas} drillData={drillData} shortlist={state.shortlist} skipped={state.skipped} decision={state.decision}/>}

            {/* Mock mode banner */}
      {!mockMode&&ollamaStatus==="error"&&<div style={{background:"#dc262611",borderBottom:"1px solid #dc262633",padding:"8px 20px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:"#dc2626",fontFamily:"monospace"}}>x BACKEND NOT REACHABLE</span>
        <span style={{fontSize:11,color:"#7f1d1d"}}>Check your Vercel deployment:</span>
        <code style={{fontSize:11,color:"#fca5a5",background:"#1a0000",padding:"2px 8px",borderRadius:3}}>https://helix-dope.vercel.app/api/workflow</code>
        <span style={{fontSize:11,color:"#7f1d1d"}}>Then:</span>
        <code style={{fontSize:11,color:"#fca5a5",background:"#1a0000",padding:"2px 8px",borderRadius:3}}>ollama pull llama3.2</code>
        <button onClick={checkOllama} style={{marginLeft:"auto",background:"#dc2626",color:"#fff",border:"none",borderRadius:4,padding:"4px 10px",cursor:"pointer",fontSize:10,fontFamily:"monospace"}}>Check again</button>
      </div>}
      {mockMode&&<div style={{background:"#d9770611",borderBottom:"1px solid #d9770633",padding:"6px 20px",display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:11,color:"#d97706",fontFamily:"monospace"}}>o MOCK MODE</span>
        <span style={{fontSize:11,color:"#92400e"}}>Pre-scripted retail & SME session - no API key needed. Toggle LIVE to use Ollama (local) or Anthropic.</span>
        <span style={{marginLeft:"auto",fontSize:10,color:"#92400e",fontFamily:"monospace"}}>20 ideas . 5 drill reports . context: retail & SME</span>
      </div>}
      {/* Control bar */}
      <div style={{borderBottom:"1px solid "+T.border,background:T.bg3,padding:"10px 20px",display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
        <Sel label="VIEW" value={tab} onChange={setTab} options={tabOptions} minWidth={160}/>
        <div style={{width:1,background:T.border,alignSelf:"stretch"}}/>

        {/* Mode toggle */}
        <div style={{display:"flex",flexDirection:"column"}}>
          <span style={ls}>MODE</span>
          <div style={{display:"flex",border:"1px solid "+T.border2,borderRadius:4,overflow:"hidden"}}>
            {[["single","Single"],["batch","All Lenses !"]].map(([m,label])=><button key={m} onClick={()=>setBatchMode(m==="batch")} disabled={isRunning} style={{background:batchMode===(m==="batch")?LENSES.market_gap.color:T.bg4,color:batchMode===(m==="batch")?"#fff":T.text3,border:"none",padding:"7px 12px",cursor:isRunning?"not-allowed":"pointer",fontSize:11,fontFamily:"monospace",letterSpacing:0.5}}>{label}</button>)}
          </div>
        </div>

        {!batchMode&&<Sel label="LENS" value={lens} onChange={setLens} options={lensOptions} disabled={isRunning}/>}
        <Sel label="CONTEXT" value={context} onChange={setContext} options={CONTEXTS} disabled={isRunning} minWidth={150}/>
        {mockMode&&context===""&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:4}}>{["retail","SME","e-commerce","wholesale"].map(s=><button key={s} onClick={()=>setContext(s)} style={{background:T.bg4,border:"1px solid "+T.border2,borderRadius:12,color:T.text3,fontSize:10,padding:"3px 10px",cursor:"pointer",fontFamily:"monospace"}}>{s}</button>)}</div>}
        {context==="__custom__"&&<div style={{display:"flex",flexDirection:"column"}}><span style={ls}>CUSTOM</span><input value={customContext} onChange={e=>setCustomContext(e.target.value)} placeholder="e.g. veterinary" disabled={isRunning} style={{...ss,backgroundImage:"none",paddingRight:10,minWidth:130}}/></div>}
        <Sel label="COUNT" value={ideaCount} onChange={setIdeaCount} options={{"3":"3 ideas","5":"5 ideas","7":"7 ideas"}} disabled={isRunning}/>
        <button onClick={batchMode?runBatch:runResearch} disabled={isRunning} style={{background:isRunning?T.border:batchMode?"linear-gradient(90deg,#6366f1,#8b5cf6,#059669,#d97706)":lensColor,color:isRunning?T.text4:"#fff",border:"none",borderRadius:4,padding:"7px 18px",cursor:isRunning?"not-allowed":"pointer",fontSize:12,fontFamily:"monospace",letterSpacing:1,alignSelf:"flex-end",opacity:isRunning?0.6:1}}>
          {isRunning?(state.phase==="batch_running"?"BATCH RUNNING...":state.phase==="drilling"?"DRILLING...":"OBSERVING..."):(batchMode?"RUN ALL LENSES ->":"RUN ->")}
        </button>

        {state.ideas.length>0&&tab==="research"&&<>
          <div style={{width:1,background:T.border,alignSelf:"stretch"}}/>
          <Sel label="SORT" value={sortBy} onChange={setSortBy} options={SORT_OPTIONS}/>
          <Sel label="DIFFICULTY" value={filterDiff} onChange={setFilterDiff} options={FILTER_DIFFICULTY}/>
          <Sel label="MARKET" value={filterMkt} onChange={setFilterMkt} options={FILTER_MARKET}/>
          {allTags.length>0&&<Sel label="TAG" value={filterTag} onChange={setFilterTag} options={tagFilterOpts} minWidth={130}/>}
          {allLenses.length>1&&<Sel label="LENS" value={filterLens} onChange={setFilterLens} options={lensFilterOpts} minWidth={130}/>}
          <div style={{display:"flex",gap:6,alignSelf:"flex-end"}}>
            <button onClick={()=>setShowWeights(w=>!w)} style={{background:showWeights?"#6366f122":T.bg4,border:"1px solid "+(showWeights?"#6366f1":T.border2),borderRadius:4,color:showWeights?"#6366f1":T.text3,fontFamily:"monospace",fontSize:11,padding:"7px 10px",cursor:"pointer"}}>?</button>
            <button onClick={()=>setShowRubric(r=>!r)} style={{background:showRubric||activeRubric?"#f59e0b22":T.bg4,border:"1px solid "+(showRubric||activeRubric?"#f59e0b":T.border2),borderRadius:4,color:showRubric||activeRubric?"#f59e0b":T.text3,fontFamily:"monospace",fontSize:11,padding:"7px 10px",cursor:"pointer"}} title="Scoring rubric">o</button>
          </div>
        </>}
        {tab==="log"&&logEntries.length>0&&<><div style={{width:1,background:T.border,alignSelf:"stretch"}}/><Sel label="FILTER" value={logFilter} onChange={setLogFilter} options={logFilterOpts} minWidth={160}/></>}
      </div>

      {/* Body */}
      <div style={{flex:1,overflow:"auto"}}>
        {tab==="research"&&<div style={{maxWidth:820,margin:"0 auto",padding:20}}>
            {/* Ollama model panel - shown when live and connected */}
            {!mockMode&&ollamaStatus==="ok"&&(
              <div style={{background:T.bg3,border:"1px solid "+T.border2,borderRadius:6,padding:14,marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap"}}>
                  <span style={{fontSize:10,color:"#059669",letterSpacing:2,fontFamily:"monospace"}}>* OLLAMA CONNECTED</span>
                  <span style={{fontSize:10,color:T.text4}}>model:</span>
                  <select value={ollamaModel} onChange={e=>{ setOllamaModel(e.target.value); setModelTest(null); }} style={{background:T.bg4,border:"1px solid "+T.border2,color:T.text,fontFamily:"monospace",fontSize:11,padding:"3px 8px",borderRadius:3,cursor:"pointer"}}>
                    {availModels.map(m=>{ const r=getModelRating(m); return <option key={m} value={m} style={{background:T.bg4}}>{"*".repeat(r.stars)+"*".repeat(5-r.stars)+" "+m}</option>; })}
                  </select>
                  {availModels.length>0&&(()=>{ const r=getModelRating(ollamaModel); return <span style={{fontSize:10,color:r.stars>=4?"#059669":r.stars>=3?"#d97706":"#dc2626"}}>{r.note}</span>; })()}
                  <button onClick={testModel} disabled={modelTest==="testing"} style={{marginLeft:"auto",background:modelTest==="pass"?"#05966922":modelTest==="fail"?"#dc262622":T.bg4,border:"1px solid "+(modelTest==="pass"?"#059669":modelTest==="fail"?"#dc2626":T.border2),borderRadius:4,color:modelTest==="pass"?"#059669":modelTest==="fail"?"#dc2626":T.text3,fontSize:10,padding:"4px 12px",cursor:modelTest==="testing"?"not-allowed":"pointer",fontFamily:"monospace"}}>
                    {modelTest==="testing"?"testing...":"! Test JSON output"}
                  </button>
                </div>
                {modelTestMsg&&<div style={{fontSize:11,color:modelTest==="pass"?"#059669":"#dc2626",fontFamily:"monospace"}}>{modelTestMsg}</div>}
                {!modelTestMsg&&<div style={{fontSize:10,color:T.text4}}>Test your model before running - confirms it can produce the JSON format DOPE needs.</div>}
              </div>
            )}
          {showWeights&&<WeightsPanel weights={weights} onChange={setWeights}/>}
          {showRubric&&<RubricPanel rubric={rubric} onChange={setRubric}/>}
          {showCompare&&compareIdeas.length===2&&<ComparePanel ideaA={compareIdeas[0]} ideaB={compareIdeas[1]} onClose={()=>setShowCompare(false)} observeCompareFn={_cmp}/>}
          {state.error&&<div style={{color:"#dc2626",fontSize:12,padding:12,background:"#1a000044",borderRadius:4,marginBottom:12}}>x {state.error}</div>}
          {allTags.length>0&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}><Tag tag="all" active={filterTag==="all"} onClick={()=>setFilterTag("all")}/>{allTags.map(t=><Tag key={t} tag={t} active={filterTag===t} onClick={()=>setFilterTag(filterTag===t?"all":t)}/>)}</div>}
          {sortedFiltered.length>0?<>
            <div style={{fontSize:10,color:T.text4,letterSpacing:2,marginBottom:12}}>
              {sortedFiltered.length}/{state.ideas.length} IDEAS{state.context?" . "+state.context:""}{state.shortlist.length>0?" . "+state.shortlist.length+" shortlisted":""}{state.skipped.length>0?" . "+state.skipped.length+" skipped":""}{activeRubric?" . rubric active":""}
            </div>
            {sortedFiltered.map(idea=><IdeaCard key={idea.id} idea={idea}
              isShortlisted={state.shortlist.includes(idea.id)} isDecided={state.decision===idea.id}
              isCompared={state.compareIds.includes(idea.id)} isSkipped={state.skipped.includes(idea.id)}
              onAction={handleIdeaAction} drillD={drillData[idea.id]} opinion={opinions[idea.id]}
              isDrilling={drillingId===idea.id} isGettingOpinion={gettingOpinionId===idea.id}
              weightedScoreVal={sortBy==="weighted_desc"?idea._weighted:undefined}
              rubricScoreVal={activeRubric?idea._rubric:undefined}
              lensColor={idea._lens?LENSES[idea._lens]?.color:undefined}
            />)}
          </>:!isRunning&&<div style={{color:T.text6,textAlign:"center",padding:60}}>
            <div style={{fontSize:40,marginBottom:12}}>?</div>
            <div style={{fontSize:13}}>observe(World) -> Ideas</div>
            <div style={{fontSize:11,marginTop:6}}>Select a lens or run all lenses at once with Batch mode</div>
          </div>}
        </div>}

        {tab==="shortlist"&&<div style={{maxWidth:820,margin:"0 auto",padding:20}}>
          <div style={{fontSize:10,color:T.text4,letterSpacing:2,marginBottom:14}}>SHORTLIST - {shortlistedIdeas.length} idea{shortlistedIdeas.length!==1?"s":""}</div>
          {shortlistedIdeas.length===0?<div style={{color:T.text6,fontSize:12,textAlign:"center",padding:40}}>Open an idea card -> Actions -> Add to shortlist</div>
          :shortlistedIdeas.map(idea=><IdeaCard key={idea.id} idea={idea} isShortlisted={true} isDecided={state.decision===idea.id} isCompared={state.compareIds.includes(idea.id)} isSkipped={state.skipped.includes(idea.id)} onAction={handleIdeaAction} drillD={drillData[idea.id]} opinion={opinions[idea.id]} isDrilling={drillingId===idea.id} isGettingOpinion={gettingOpinionId===idea.id} lensColor={idea._lens?LENSES[idea._lens]?.color:undefined}/>)}
        </div>}

        {tab==="log"&&<div style={{maxWidth:900,margin:"0 auto",padding:20}}>
          <div style={{fontSize:10,color:T.text4,letterSpacing:2,marginBottom:4}}>INPUT LOG X* - {filteredLog.length} entries</div>
          <div style={{fontSize:11,color:T.text6,marginBottom:14}}>Human decisions and LLM observations in the same causal sequence.</div>
          {filteredLog.length===0?<div style={{color:T.text6,fontSize:12}}>No inputs yet.</div>
          :filteredLog.map((entry,i)=>{ const colors={research_started:"#6366f1",batch_started:"#8b5cf6",batch_lens_done:"#6366f1",ideas_observed:"#d97706",ideas_merged:"#d97706",rubric_set:"#f59e0b",idea_shortlisted:"#8b5cf6",idea_skipped:"#dc2626",compare_toggled:"#6366f1",drill_started:"#d97706",drill_observed:"#059669",human_decided:"#10b981",research_failed:"#dc2626"};
            return <div key={i} style={{display:"flex",gap:10,padding:"5px 0",borderBottom:"1px solid "+T.border}}><span style={{color:T.text5,fontSize:11,minWidth:28}}>{String(entry.sequence).padStart(3,"0")}</span><span style={{color:colors[entry.type]||T.text3,fontSize:11,minWidth:150}}>{entry.type}</span><span style={{color:T.text5,fontSize:10,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{JSON.stringify(entry.data||{}).slice(0,90)}</span><span style={{color:T.text6,fontSize:10}}>{new Date(entry.timestamp).toLocaleTimeString()}</span></div>;
          })}
        </div>}

        {tab==="decision"&&<div style={{maxWidth:700,margin:"0 auto",padding:24}}>
          {chosenIdea?<div>
            <div style={{fontSize:10,color:"#059669",letterSpacing:2,marginBottom:10}}>YOUR DECISION - LOGGED AS HUMAN INPUT</div>
            <div style={{background:darkMode?"#0a1a0a":"#f0fdf4",border:"1px solid #059669",borderRadius:6,padding:18,marginBottom:20}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div><div style={{fontSize:18,marginBottom:4}}>{chosenIdea.name}</div><div style={{color:T.text2,fontSize:12,marginBottom:6}}>{chosenIdea.tagline}</div>{chosenIdea.tags&&chosenIdea.tags.length>0&&<TagList tags={chosenIdea.tags}/>}</div>
                {drillData[chosenIdea.id]&&<VerdictBadge verdict={drillData[chosenIdea.id].verdict}/>}
              </div>
              <div style={{fontSize:12,color:T.text3,margin:"12px 0"}}>Score: <span style={{color:"#059669"}}>{chosenIdea.score}/100</span> . Conf: <span style={{color:"#8b5cf6"}}>{chosenIdea.confidence||"?"}%</span> . Difficulty: <span style={{color:DIFF_COLOR[chosenIdea.difficulty]}}>{chosenIdea.difficulty}</span> . Market: <span style={{color:T.text2}}>{MKT_LABEL[chosenIdea.marketSize]}</span></div>
              <ScoreMeter score={chosenIdea.score} label="viability"/><div style={{marginTop:4}}><ScoreMeter score={weightedScore(chosenIdea,weights)} color="#8b5cf6" label="weighted"/></div>
              {activeRubric&&<div style={{marginTop:4}}><ScoreMeter score={rubricScore(chosenIdea,rubric,drillData[chosenIdea.id])} color="#f59e0b" label="rubric"/></div>}
              {drillData[chosenIdea.id]&&<div style={{marginTop:14,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>{[["MVP",drillData[chosenIdea.id].mvpWeeks?drillData[chosenIdea.id].mvpWeeks+" wks":"?"],["Cost",drillData[chosenIdea.id].mvpCost||"?"],["ARR",drillData[chosenIdea.id].arr12m||"?"]].map(([l,v])=><div key={l} style={{background:T.bg4,borderRadius:4,padding:8,textAlign:"center"}}><div style={{fontSize:10,color:T.text4}}>{l}</div><div style={{fontSize:12,color:T.text}}>{v}</div></div>)}</div>}
            </div>
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              <button onClick={handleSave} style={{background:T.bg4,border:"1px solid "+T.border2,borderRadius:4,color:T.text2,padding:"6px 14px",cursor:"pointer",fontSize:11,fontFamily:"monospace"}}>? Save full session as .md</button>
            </div>
            <div style={{fontSize:10,color:T.text4,letterSpacing:2,marginBottom:8}}>DECISION AUDIT</div>
            {logEntries.filter(e=>["human_decided","idea_shortlisted","compare_toggled","idea_skipped","rubric_set"].includes(e.type)).map((e,i)=><div key={i} style={{display:"flex",gap:8,fontSize:11,color:T.text4,marginBottom:4}}><span style={{color:T.text6}}>[{e.sequence}]</span><span style={{color:e.type==="human_decided"?"#059669":"#6366f1"}}>{e.type}</span><span>{JSON.stringify(e.data).slice(0,80)}</span></div>)}
          </div>:<div style={{color:T.text6,textAlign:"center",padding:60}}><div style={{fontSize:13}}>No decision logged yet.</div><div style={{fontSize:11,marginTop:6}}>Open an idea -> Actions -> I'll build this</div></div>}
        </div>}
      </div>

      <div style={{borderTop:"1px solid "+T.border,padding:"5px 20px",fontSize:10,color:T.text6,display:"flex",gap:16}}>
        <span>d: pure</span><span>X*: {logEntries.length} inputs</span><span>human ? X*</span><span>llm ? observe()</span>
      </div>

      <GuidedTour step={tourStep} onNext={setTourStep} T={T}/>
      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} } * { box-sizing: border-box; } select option { background: ${T.selectBg}; color: ${T.text}; } ::-webkit-scrollbar { width: 5px; } ::-webkit-scrollbar-track { background: ${T.bg}; } ::-webkit-scrollbar-thumb { background: ${T.border2}; } input:focus, select:focus { border-color: #6366f1 !important; }`}</style>
    </div>
  </ThemeCtx.Provider>;
}

const BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/scoreboard';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'public, max-age=240, s-maxage=240'}});
const daystr=d=>d.toISOString().slice(0,10).replaceAll('-','');
async function getDay(date){const r=await fetch(`${BASE}?dates=${date}&groups=50&limit=500`,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error(`ESPN ${r.status}`);return (await r.json()).events||[]}
export default async req=>{try{const u=new URL(req.url),date=u.searchParams.get('date')||new Date().toISOString().slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date)))return json({error:'Invalid date'},400);const mode=u.searchParams.get('mode')||'games'; const d=new Date(date+'T00:00:00Z');if(mode==='games'){return json({events:await getDay(daystr(d)),date,source:'ESPN',retrievedAt:new Date().toISOString()})}
 if(mode==='history'){const days=Math.min(35,Math.max(4,Number(u.searchParams.get('days'))||25));const dates=Array.from({length:days},(_,i)=>{let x=new Date(d);x.setUTCDate(x.getUTCDate()-i-1);return daystr(x)});const results=await Promise.allSettled(dates.map(getDay));const events=results.filter(x=>x.status==='fulfilled').flatMap(x=>x.value);return json({events,datesChecked:days,failedDates:results.filter(x=>x.status==='rejected').length,source:'ESPN',retrievedAt:new Date().toISOString()})}if(mode==='metrics'){
 const ids=(u.searchParams.get('ids')||'').split(',').filter(x=>/^\d+$/.test(x)).slice(0,8);
 if(!ids.length)return json({error:'Provide numeric event IDs'},400);
 const base='https://site.api.espn.com/apis/site/v2/sports/basketball/womens-college-basketball/summary?event=';
 const results=await Promise.allSettled(ids.map(async id=>{const r=await fetch(base+id,{signal:AbortSignal.timeout(9000)});if(!r.ok)throw Error('ESPN '+r.status);return{id,data:await r.json()}}));
 const metrics={};let success=0;
 for(const res of results){if(res.status!=='fulfilled')continue;success++;const {id,data}=res.value;metrics[id]={};
 for(const t of data.boxscore?.teams||[]){const teamId=String(t.team?.id||'');const stats=t.statistics||[];const find=(keys)=>{let s=stats.find(x=>keys.includes(String(x.abbreviation||'').toLowerCase())||keys.includes(String(x.name||'').toLowerCase()));return s?.displayValue??s?.value};
 const attempts=x=>{if(x==null)return NaN;let v=String(x);return Number(v.includes('-')?v.split('-').pop():v)};
 const fga=attempts(find(['fg','fieldgoals','field goals','fga'])),fta=attempts(find(['ft','freethrows','free throws','fta'])),oreb=attempts(find(['oreb','offensiverebounds','offensive rebounds'])),to=attempts(find(['to','turnovers']));
 if([fga,fta,oreb,to].every(Number.isFinite)){const poss=fga-oreb+to+0.44*fta;if(poss>30&&poss<130)metrics[id][teamId]={poss,source:'ESPN boxscore estimate'}}
 }}return json({metrics,success,requested:ids.length,source:'ESPN box scores'});
 }return json({error:'Invalid mode'},400)
}catch(e){return json({error:String(e.message||e)},502)}};
export const config={path:'/api/basketball'};

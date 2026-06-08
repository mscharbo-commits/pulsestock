export const config = { runtime: 'edge' };
const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

export default async function handler(req) {
  const ticker = new URL(req.url).searchParams.get('ticker') || 'AAPL';
  const results = {};

  // Step 1: Search Wikidata for the company
  const searchRes = await fetch(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${ticker}&language=en&format=json&limit=3`,
    { headers: { 'User-Agent': 'PulseStock/1.0 research@pulsestock.com' } }
  );
  const searchData = await searchRes.json();
  const entity = searchData.search?.[0];
  results.search = { id: entity?.id, label: entity?.label, shortDesc: entity?.description };

  if (entity?.id) {
    // Step 2: Get full entity data including Wikipedia article link
    const entityRes = await fetch(
      `https://www.wikidata.org/wiki/Special:EntityData/${entity.id}.json`,
      { headers: { 'User-Agent': 'PulseStock/1.0' } }
    );
    const entityData = await entityRes.json();
    const e = entityData.entities?.[entity.id];

    // Get English Wikipedia article title from sitelinks
    const wikiTitle = e?.sitelinks?.enwiki?.title;
    results.wikiTitle = wikiTitle;

    // Get English description (longer one from claims if available)
    const engDesc = e?.descriptions?.en?.value;
    results.entityDesc = engDesc;

    // Step 3: Get Wikipedia article summary using the title
    if (wikiTitle) {
      const wikiRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`,
        { headers: { 'User-Agent': 'PulseStock/1.0' } }
      );
      const wikiData = await wikiRes.json();
      results.wikipedia = {
        title: wikiData.title,
        extract: wikiData.extract,
        type: wikiData.type,
      };
    }

    // Step 4: DBpedia with entity id (use Wikipedia title for DBpedia)
    if (wikiTitle) {
      const dbRes = await fetch(
        `https://dbpedia.org/data/${encodeURIComponent(wikiTitle.replace(/ /g,'_'))}.json`,
        { headers: { 'Accept': 'application/json', 'User-Agent': 'PulseStock/1.0' } }
      );
      if (dbRes.ok) {
        const dbData = await dbRes.json();
        const key = `http://dbpedia.org/resource/${wikiTitle.replace(/ /g,'_')}`;
        const abstract = dbData[key]?.['http://dbpedia.org/ontology/abstract'];
        const engAbstract = abstract?.find(a => a.lang === 'en');
        results.dbpedia = { abstract: engAbstract?.value?.slice(0, 400) };
      }
    }
  }

  return new Response(JSON.stringify(results, null, 2), { headers: cors });
}

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {availabilityResult} from '../worker/worker.mjs';
const basic={hotelBasicInfo:{hotelNo:123,planListUrl:'https://hotel.travel.rakuten.co.jp/hotelinfo/plan/123',hotelInformationUrl:'https://travel.rakuten.co.jp/HOTEL/123/'}};
const room=url=>({roomInfo:[{roomBasicInfo:{planName:'朝食付き',roomName:'ツイン',reserveUrl:url}},{dailyCharge:{total:10000}}]});
const response=(parts)=>({hotels:[{hotel:[basic,...parts]}]});
test('plan links preserve provider URLs and exact hotel identity; duplicate plans and prices are not invented',()=>{
 const url='https://img.travel.rakuten.co.jp/image/tr/api/re/IdsCY/?f_no=123';
 const j=availabilityResult(response([room(url),room(url)]),123);
 assert.equal(j.availabilityStatus,'plans_available');assert.equal(j.items.length,1);assert.equal(j.items[0].url,url);assert(!('price' in j.items[0]));
 assert.equal(availabilityResult(response([room(url)]),456).availabilityStatus,'no_availability');
});
test('empty inventory, missing links, rejected links and absent room details have distinct diagnostics',()=>{
 assert.equal(availabilityResult({hotels:[]},123).availabilityStatus,'no_availability');
 const missing=availabilityResult(response([room('')]),123);assert.equal(missing.availabilityStatus,'links_unavailable');assert.equal(missing.diagnostic.missingLinks,1);assert.equal(missing.facilityUrl,basic.hotelBasicInfo.planListUrl);
 const rejected=availabilityResult(response([room('https://evil.test/?secret=PRIVATE')]),123);assert.equal(rejected.diagnostic.rejectedLinks,1);assert(!JSON.stringify(rejected).includes('PRIVATE'));
 assert.equal(availabilityResult(response([]),123).availabilityStatus,'no_room_details');
});
test('object-style hotel and room blocks are normalized without mixing hotels',()=>{
 const j=availabilityResult({hotels:[{hotel:{...basic,roomInfo:{roomBasicInfo:{roomName:'和室',reserveUrl:'https://hotel.travel.rakuten.co.jp/plan/123/'}}}}]},123);
 assert.equal(j.items.length,1);assert.equal(j.items[0].name,'和室');
});

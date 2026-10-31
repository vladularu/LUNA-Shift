-- Isolated database only; fixture data is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
grant usage on schema extensions to authenticated;
select no_plan();
insert into auth.users(id) values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into auth.sessions(id,user_id) values
 ('00000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111'),
 ('00000000-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222');
insert into luna_private_cloud.accounts(user_id,revision) values('11111111-1111-4111-8111-111111111111',1);
insert into luna_private_cloud.snapshots(user_id,revision,mutation_id,expected_revision,document) values
 ('11111111-1111-4111-8111-111111111111',1,gen_random_uuid(),0,'{"presentation":{"accountPhoto":"/9j/AA=="},"data":{"secret":"private"}}');
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"00000000-0000-4000-8000-000000000001"}',true);
select is(public.sharing_create_calendar('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dddddddd-dddd-4ddd-8ddd-dddddddddddd',repeat('a',64),'Plan','#527D92','DETAILS')->>'revision','0','owner creates calendar');
reset role;
create temp table photo_invite as select public.sharing_create_invite_v3('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',gen_random_uuid(),'{"shifts":true,"appointments":false,"notes":false}',true) as data;
grant select on photo_invite to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","session_id":"00000000-0000-4000-8000-000000000002"}',true);
select is(public.sharing_claim_invite('22222222-2222-4222-8222-222222222222',(select data->>'token' from photo_invite),'Sam')->>'status','ACTIVE','photo invitation activates selected rights');
select is(public.sharing_get_profile_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null)->>'image','/9j/AA==','explicitly authorized member receives photo');
select ok(not (public.sharing_get_profile_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null) ? 'document'),'private document never returned');
select is(public.sharing_get_profile_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',encode(extensions.digest('/9j/AA==','sha256'),'hex'))->>'unchanged','true','known photo avoids retransmitting image');
select throws_ok($q$select public.sharing_set_member_profile_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222',true)$q$,'42501','SHARE_NOT_FOUND','recipient cannot grant themselves access');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","session_id":"00000000-0000-4000-8000-000000000001"}',true);
select is(public.sharing_set_member_profile_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222',false)->>'shareProfilePhoto','false','owner can withdraw photo consent');
select ok(not (public.sharing_list_members_v2('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->'members'->0 ? 'shareProfilePhoto'),'legacy response keys remain unchanged');
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","session_id":"00000000-0000-4000-8000-000000000002"}',true);
select is(public.sharing_get_profile_photo('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',null)->'image','null'::jsonb,'withdrawal removes photo from future responses');
select throws_ok($q$select document from luna_private_cloud.snapshots$q$,'42501',null,'recipient cannot read private cloud snapshots');
select * from finish();
rollback;

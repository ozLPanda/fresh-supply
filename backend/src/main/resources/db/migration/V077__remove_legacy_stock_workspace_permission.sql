delete from role_permissions
where permission_id in (select id from permissions where code = 'pages.stocks.view');

delete from user_permissions
where permission_id in (select id from permissions where code = 'pages.stocks.view');

delete from permissions where code = 'pages.stocks.view';

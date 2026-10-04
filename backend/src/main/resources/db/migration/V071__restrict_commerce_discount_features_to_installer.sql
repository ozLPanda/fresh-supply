-- By default these permissions are granted only through the Installer role.
-- Runtime access remains permission-based, so they can also be delegated explicitly when needed.
delete from role_permissions rp
using roles r, permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.code <> 'installer'
  and p.code in (
      'commerce.prices.wholesale',
      'commerce.prices.bulkWholesale',
      'commerce.prices.sko',
      'commerce.invoices.create'
  );

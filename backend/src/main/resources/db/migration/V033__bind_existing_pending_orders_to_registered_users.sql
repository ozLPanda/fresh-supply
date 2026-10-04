update orders o
set user_id = u.id
from users u
where o.user_id is null
  and (
    (o.pending_customer_email is not null and lower(trim(u.email)) = o.pending_customer_email)
    or (
      o.pending_customer_phone is not null
      and right(regexp_replace(coalesce(u.phone, ''), '\D', '', 'g'), 10)
          = right(o.pending_customer_phone, 10)
    )
  );

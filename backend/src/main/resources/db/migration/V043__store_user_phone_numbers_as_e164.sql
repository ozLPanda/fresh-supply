with normalized_phones as (
    select
        id,
        case
            when length(regexp_replace(phone, '\D', '', 'g')) = 10
                then '7' || regexp_replace(phone, '\D', '', 'g')
            when regexp_replace(phone, '\D', '', 'g') like '8%'
                then '7' || substring(regexp_replace(phone, '\D', '', 'g') from 2)
            else regexp_replace(phone, '\D', '', 'g')
        end as digits
    from users
    where phone is not null
)
update users as u
set phone = '+' || normalized_phones.digits
from normalized_phones
where u.id = normalized_phones.id
  and length(normalized_phones.digits) = 11
  and normalized_phones.digits ~ '^7';

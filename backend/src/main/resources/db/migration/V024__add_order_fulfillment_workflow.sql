alter table orders
    add column assembly_assignee_id bigint,
    add column checking_assignee_id bigint;

alter table orders
    add constraint orders_assembly_assignee_fk foreign key (assembly_assignee_id) references users(id),
    add constraint orders_checking_assignee_fk foreign key (checking_assignee_id) references users(id);

alter table order_items
    add column assembled boolean not null default false,
    add column checked boolean not null default false;

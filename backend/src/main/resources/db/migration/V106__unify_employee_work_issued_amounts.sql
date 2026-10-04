update employee_work_transactions set type = 'PAYMENT' where type = 'LOAN';

alter table employee_work_transactions drop constraint if exists employee_work_transactions_type_check;
alter table employee_work_transactions alter column type set default 'PAYMENT';
alter table employee_work_transactions
 add constraint employee_work_transactions_type_check check(type = 'PAYMENT');

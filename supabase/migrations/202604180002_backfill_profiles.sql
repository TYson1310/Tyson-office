insert into public.profiles (
  id,
  email,
  full_name,
  role,
  status,
  permissions,
  department,
  position_title
)
select
  users.id,
  users.email,
  coalesce(
    users.raw_user_meta_data ->> 'full_name',
    split_part(coalesce(users.email, ''), '@', 1)
  ) as full_name,
  case
    when coalesce(users.raw_user_meta_data ->> 'role', 'employee') in (
      'admin',
      'manager',
      'employee',
      'cashier',
      'warehouse',
      'accountant'
    ) then coalesce(users.raw_user_meta_data ->> 'role', 'employee')
    else 'employee'
  end as role,
  'active' as status,
  case
    when coalesce(users.raw_user_meta_data ->> 'role', 'employee') = 'admin' then array['*']::text[]
    when coalesce(users.raw_user_meta_data ->> 'role', 'employee') = 'manager' then array[
      'view:dashboard',
      'view:inventory',
      'view:orders',
      'view:suppliers',
      'view:payroll',
      'view:reports'
    ]::text[]
    when coalesce(users.raw_user_meta_data ->> 'role', 'employee') = 'accountant' then array[
      'view:financials',
      'view:payroll',
      'view:vendors',
      'view:reports'
    ]::text[]
    when coalesce(users.raw_user_meta_data ->> 'role', 'employee') = 'cashier' then array[
      'view:profile',
      'view:sales',
      'create:sales'
    ]::text[]
    when coalesce(users.raw_user_meta_data ->> 'role', 'employee') = 'warehouse' then array[
      'view:inventory',
      'update:inventory',
      'view:profile'
    ]::text[]
    else array[
      'view:profile',
      'view:schedule',
      'view:payroll',
      'view:performance'
    ]::text[]
  end as permissions,
  users.raw_user_meta_data ->> 'department' as department,
  users.raw_user_meta_data ->> 'position_title' as position_title
from auth.users as users
left join public.profiles as profiles on profiles.id = users.id
where profiles.id is null;
